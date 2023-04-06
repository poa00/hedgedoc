/*
 * SPDX-FileCopyrightText: 2022 The HedgeDoc developers (see AUTHORS file)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Mock } from 'ts-mockery';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuthToken } from '../auth/auth-token.entity';
import { Author } from '../authors/author.entity';
import { DefaultAccessLevel } from '../config/default-access-level.enum';
import { GuestAccess } from '../config/guest_access.enum';
import appConfigMock from '../config/mock/app.config.mock';
import authConfigMock from '../config/mock/auth.config.mock';
import databaseConfigMock from '../config/mock/database.config.mock';
import {
  createDefaultMockNoteConfig,
  registerNoteConfig,
} from '../config/mock/note.config.mock';
import { NoteConfig } from '../config/note.config';
import { PermissionsUpdateInconsistentError } from '../errors/errors';
import { eventModuleConfig, NoteEvent } from '../events';
import { Group } from '../groups/group.entity';
import { GroupsModule } from '../groups/groups.module';
import { SpecialGroup } from '../groups/groups.special';
import { Identity } from '../identity/identity.entity';
import { LoggerModule } from '../logger/logger.module';
import { Alias } from '../notes/alias.entity';
import {
  NoteGroupPermissionUpdateDto,
  NoteUserPermissionUpdateDto,
} from '../notes/note-permissions.dto';
import { Note } from '../notes/note.entity';
import { NotesModule } from '../notes/notes.module';
import { Tag } from '../notes/tag.entity';
import { Edit } from '../revisions/edit.entity';
import { Revision } from '../revisions/revision.entity';
import { Session } from '../users/session.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { NoteGroupPermission } from './note-group-permission.entity';
import { NoteUserPermission } from './note-user-permission.entity';
import { PermissionsModule } from './permissions.module';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let noteRepo: Repository<Note>;
  let userRepo: Repository<User>;
  let groupRepo: Repository<Group>;
  let eventEmitter: EventEmitter2;

  let noteNobodyRead: Note;
  let noteUser1Read: Note;
  let noteAllUsersRead1: Note;
  let noteAllUsersRead2: Note;
  let noteUser2Write: Note;
  let noteAllWrite1: Note;
  let noteAllWrite2: Note;
  let noteUser2Read: Note;
  let noteEverybodyNone: Note;
  let noteEverybodyWrite: Note;
  let noteEverybodyRead: Note;

  const noteMockConfig: NoteConfig = createDefaultMockNoteConfig();

  beforeAll(async () => {
    /**
     * We need to have *one* userRepo and *one* noteRepo for both the providers
     * array and the overrideProvider call, as otherwise we have two instances
     * and the mock of createQueryBuilder replaces the wrong one
     * **/
    userRepo = Mock.of<Repository<User>>({
      save: async (entry: Note) => entry,
      findOne: jest.fn(),
    });
    noteRepo = Mock.of<Repository<Note>>({
      save: async (entry: Note) => entry,
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: getRepositoryToken(Note),
          useValue: noteRepo,
        },
        {
          provide: getRepositoryToken(Group),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
      ],
      imports: [
        LoggerModule,
        PermissionsModule,
        UsersModule,
        NotesModule,
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            appConfigMock,
            databaseConfigMock,
            authConfigMock,
            registerNoteConfig(noteMockConfig),
          ],
        }),
        GroupsModule,
        EventEmitterModule.forRoot(eventModuleConfig),
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(userRepo)
      .overrideProvider(getRepositoryToken(AuthToken))
      .useValue({})
      .overrideProvider(getRepositoryToken(Identity))
      .useValue({})
      .overrideProvider(getRepositoryToken(Edit))
      .useValue({})
      .overrideProvider(getRepositoryToken(Revision))
      .useValue({})
      .overrideProvider(getRepositoryToken(Note))
      .useValue(noteRepo)
      .overrideProvider(getRepositoryToken(Tag))
      .useValue({})
      .overrideProvider(getRepositoryToken(NoteGroupPermission))
      .useValue({})
      .overrideProvider(getRepositoryToken(NoteUserPermission))
      .useValue({})
      .overrideProvider(getRepositoryToken(Group))
      .useClass(Repository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue({})
      .overrideProvider(getRepositoryToken(Author))
      .useValue({})
      .overrideProvider(getRepositoryToken(Alias))
      .useValue({})
      .compile();
    service = module.get<PermissionsService>(PermissionsService);
    await createNoteUserPermissionNotes();
    groupRepo = module.get<Repository<Group>>(getRepositoryToken(Group));
    noteRepo = module.get<Repository<Note>>(getRepositoryToken(Note));
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // The two users we test with:
  const user1 = Mock.of<User>({ id: 1 });
  const user2 = Mock.of<User>({ id: 2 });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function createNote(owner: User): Note {
    return Mock.of<Note>({
      userPermissions: Promise.resolve([]),
      groupPermissions: Promise.resolve([]),
      owner: Promise.resolve(owner),
    });
  }

  function createUserPermission(
    user: User,
    canEdit: boolean,
  ): NoteUserPermission {
    return Mock.of<NoteUserPermission>({
      user: Promise.resolve(user),
      canEdit: canEdit,
    });
  }

  function createGroupPermission(
    group: Group,
    note: Note,
    canEdit: boolean,
  ): NoteGroupPermission {
    const groupPermission = Mock.of<NoteGroupPermission>({
      group: Promise.resolve(group),
      canEdit: canEdit,
      note: Promise.resolve(note),
    });
    note.groupPermissions = Promise.resolve([groupPermission]);
    return groupPermission;
  }

  /*
   * Creates the permission objects for UserPermission for two users with write and with out write permission
   */
  async function createNoteUserPermissionNotes(): Promise<void> {
    const user1ReadPermission = createUserPermission(user1, false);
    const user2ReadPermission = createUserPermission(user2, false);
    const user1WritePermission = createUserPermission(user1, true);
    const user2WritePermission = createUserPermission(user2, true);

    noteNobodyRead = createNote(user1);
    noteUser1Read = createNote(user2);
    noteAllUsersRead1 = createNote(user2);
    noteAllUsersRead2 = createNote(user2);
    noteUser2Write = createNote(user2);
    noteAllWrite1 = createNote(user2);
    noteAllWrite2 = createNote(user2);
    noteUser2Read = createNote(user2);

    (await noteUser1Read.userPermissions).push(user1ReadPermission);
    (await noteUser2Read.userPermissions).push(user2ReadPermission);

    (await noteAllUsersRead1.userPermissions).push(user1ReadPermission);
    (await noteAllUsersRead1.userPermissions).push(user2ReadPermission);

    (await noteAllUsersRead2.userPermissions).push(user1ReadPermission);
    (await noteAllUsersRead2.userPermissions).push(user2ReadPermission);

    (await noteUser2Write.userPermissions).push(user1WritePermission);

    (await noteAllWrite1.userPermissions).push(user1WritePermission);
    (await noteAllWrite1.userPermissions).push(user2WritePermission);

    (await noteAllWrite2.userPermissions).push(user2WritePermission);
    (await noteAllWrite2.userPermissions).push(user1WritePermission);

    const everybody = Mock.of<Group>({
      name: SpecialGroup.EVERYONE,
      special: true,
    });

    noteEverybodyNone = createNote(user1);

    noteEverybodyRead = createNote(user1);
    createGroupPermission(everybody, noteEverybodyRead, false);

    noteEverybodyWrite = createNote(user1);
    createGroupPermission(everybody, noteEverybodyWrite, true);
  }

  describe('mayRead works with', () => {
    it('Owner', async () => {
      expect(await service.mayRead(user1, noteNobodyRead)).toBeTruthy();
      expect(await service.mayRead(user1, noteUser2Read)).toBeFalsy();
    });
    it('userPermission read', async () => {
      expect(await service.mayRead(user1, noteUser1Read)).toBeTruthy();
      expect(await service.mayRead(user1, noteAllUsersRead1)).toBeTruthy();
      expect(await service.mayRead(user1, noteAllUsersRead2)).toBeTruthy();
    });
    it('userPermission write', async () => {
      expect(await service.mayRead(user1, noteUser2Write)).toBeTruthy();
      expect(await service.mayRead(user1, noteAllWrite1)).toBeTruthy();
      expect(await service.mayRead(user1, noteAllWrite2)).toBeTruthy();
      expect(await service.mayRead(user1, noteUser2Read)).toBeFalsy();
    });

    describe('guest permission', () => {
      beforeEach(() => {
        noteMockConfig.permissions.default.loggedIn = DefaultAccessLevel.WRITE;
        noteMockConfig.permissions.default.everyone = DefaultAccessLevel.WRITE;
      });
      describe('with guest access deny', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.DENY;
        });
        it('guest permission none', async () => {
          expect(await service.mayRead(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayRead(null, noteEverybodyRead)).toBeFalsy();
        });
        it('guest permission write', async () => {
          expect(await service.mayRead(null, noteEverybodyWrite)).toBeFalsy();
        });
      });
      describe('with guest access read', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.READ;
        });
        it('guest permission none', async () => {
          expect(await service.mayRead(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayRead(null, noteEverybodyRead)).toBeTruthy();
        });
        it('guest permission write', async () => {
          expect(await service.mayRead(null, noteEverybodyWrite)).toBeTruthy();
        });
      });
      describe('with guest access write', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.WRITE;
        });
        it('guest permission none', async () => {
          expect(await service.mayRead(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayRead(null, noteEverybodyRead)).toBeTruthy();
        });
        it('guest permission write', async () => {
          expect(await service.mayRead(null, noteEverybodyWrite)).toBeTruthy();
        });
      });
      describe('with guest access create', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.CREATE;
        });
        it('guest permission none', async () => {
          expect(await service.mayRead(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayRead(null, noteEverybodyRead)).toBeTruthy();
        });
        it('guest permission write', async () => {
          expect(await service.mayRead(null, noteEverybodyWrite)).toBeTruthy();
        });
      });
    });
  });

  describe('mayWrite works with', () => {
    it('Owner', async () => {
      expect(await service.mayWrite(user1, noteNobodyRead)).toBeTruthy();
      expect(await service.mayWrite(user1, noteUser2Read)).toBeFalsy();
    });
    it('userPermission read', async () => {
      expect(await service.mayWrite(user1, noteUser1Read)).toBeFalsy();
      expect(await service.mayWrite(user1, noteAllUsersRead1)).toBeFalsy();
      expect(await service.mayWrite(user1, noteAllUsersRead2)).toBeFalsy();
    });
    it('userPermission write', async () => {
      expect(await service.mayWrite(user1, noteUser2Write)).toBeTruthy();
      expect(await service.mayWrite(user1, noteAllWrite1)).toBeTruthy();
      expect(await service.mayWrite(user1, noteAllWrite2)).toBeTruthy();
      expect(await service.mayWrite(user1, noteUser2Read)).toBeFalsy();
    });
    describe('guest permission', () => {
      beforeEach(() => {
        noteMockConfig.permissions.default.loggedIn = DefaultAccessLevel.WRITE;
        noteMockConfig.permissions.default.everyone = DefaultAccessLevel.WRITE;
      });

      describe('with guest access deny', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.DENY;
        });
        it('guest permission none', async () => {
          expect(await service.mayWrite(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayWrite(null, noteEverybodyRead)).toBeFalsy();
        });
        it('guest permission write', async () => {
          expect(await service.mayWrite(null, noteEverybodyWrite)).toBeFalsy();
        });
      });

      describe('with guest access read', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.READ;
        });
        it('guest permission none', async () => {
          expect(await service.mayWrite(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayWrite(null, noteEverybodyRead)).toBeFalsy();
        });
        it('guest permission write', async () => {
          expect(await service.mayWrite(null, noteEverybodyWrite)).toBeFalsy();
        });
      });

      describe('with guest access write', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.WRITE;
        });
        it('guest permission none', async () => {
          expect(await service.mayWrite(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayWrite(null, noteEverybodyRead)).toBeFalsy();
        });
        it('guest permission write', async () => {
          expect(await service.mayWrite(null, noteEverybodyWrite)).toBeTruthy();
        });
      });

      describe('with guest access create', () => {
        beforeEach(() => {
          noteMockConfig.guestAccess = GuestAccess.CREATE;
        });
        it('guest permission none', async () => {
          expect(await service.mayWrite(null, noteEverybodyNone)).toBeFalsy();
        });
        it('guest permission read', async () => {
          expect(await service.mayWrite(null, noteEverybodyRead)).toBeFalsy();
        });
        it('guest permission write', async () => {
          expect(await service.mayWrite(null, noteEverybodyWrite)).toBeTruthy();
        });
      });
    });
  });

  /*
   * Helper Object that arranges a list of GroupPermissions and if they allow a user to read or write a particular note.
   */
  class NoteGroupPermissionWithResultForUser {
    permissions: NoteGroupPermission[];
    allowsRead: boolean;
    allowsWrite: boolean;
  }

  /*
   * Setup function to create all the groups we use in the tests.
   */
  function createGroups(): { [id: string]: Group } {
    const result: { [id: string]: Group } = {};

    result[SpecialGroup.EVERYONE] = Group.create(
      SpecialGroup.EVERYONE,
      SpecialGroup.EVERYONE,
      true,
    ) as Group;

    result[SpecialGroup.LOGGED_IN] = Group.create(
      SpecialGroup.LOGGED_IN,
      SpecialGroup.LOGGED_IN,
      true,
    ) as Group;

    const user1group = Group.create('user1group', 'user1group', false) as Group;
    user1group.members = Promise.resolve([user1]);
    result['user1group'] = user1group;

    const user2group = Group.create('user2group', 'user2group', false) as Group;
    user2group.members = Promise.resolve([user2]);
    result['user2group'] = user2group;

    const user1and2group = Group.create(
      'user1and2group',
      'user1and2group',
      false,
    ) as Group;
    user1and2group.members = Promise.resolve([user1, user2]);
    result['user1and2group'] = user1and2group;

    const user2and1group = Group.create(
      'user2and1group',
      'user2and1group',
      false,
    ) as Group;
    user2and1group.members = Promise.resolve([user2, user1]);
    result['user2and1group'] = user2and1group;

    return result;
  }

  /*
   * Create all GroupPermissions: For each group two GroupPermissions are created one with read permission and one with write permission.
   */
  function createAllNoteGroupPermissions(): (NoteGroupPermission | null)[][] {
    const groups = createGroups();

    /*
     * Helper function for creating GroupPermissions
     */
    function createNoteGroupPermission(
      group: Group,
      write: boolean,
    ): NoteGroupPermission {
      return NoteGroupPermission.create(group, {} as Note, write);
    }

    const everybodyRead = createNoteGroupPermission(
      groups[SpecialGroup.EVERYONE],
      false,
    );
    const everybodyWrite = createNoteGroupPermission(
      groups[SpecialGroup.EVERYONE],
      true,
    );

    const loggedInRead = createNoteGroupPermission(
      groups[SpecialGroup.LOGGED_IN],
      false,
    );
    const loggedInWrite = createNoteGroupPermission(
      groups[SpecialGroup.LOGGED_IN],
      true,
    );

    const user1groupRead = createNoteGroupPermission(
      groups['user1group'],
      false,
    );
    const user1groupWrite = createNoteGroupPermission(
      groups['user1group'],
      true,
    );

    const user2groupRead = createNoteGroupPermission(
      groups['user2group'],
      false,
    );
    const user2groupWrite = createNoteGroupPermission(
      groups['user2group'],
      true,
    );

    const user1and2groupRead = createNoteGroupPermission(
      groups['user1and2group'],
      false,
    );
    const user1and2groupWrite = createNoteGroupPermission(
      groups['user1and2group'],
      true,
    );

    const user2and1groupRead = createNoteGroupPermission(
      groups['user2and1group'],
      false,
    );
    const user2and1groupWrite = createNoteGroupPermission(
      groups['user2and1group'],
      true,
    );

    return [
      [user1groupRead, user1and2groupRead, user2and1groupRead, null], // group0: allow user1 to read via group
      [user2and1groupWrite, user1and2groupWrite, user1groupWrite, null], // group1: allow user1 to write via group
      [everybodyRead, everybodyWrite, null], // group2: permissions of the special group everybody
      [loggedInRead, loggedInWrite, null], // group3: permissions of the special group loggedIn
      [user2groupWrite, user2groupRead, null], // group4: don't allow user1 to read or write via group
    ];
  }

  /*
   * creates the matrix multiplication of group0 to group4 of createAllNoteGroupPermissions
   */
  function createNoteGroupPermissionsCombinations(
    everyoneDefaultPermission: DefaultAccessLevel,
  ): NoteGroupPermissionWithResultForUser[] {
    // for logged in users
    const noteGroupPermissions = createAllNoteGroupPermissions();
    const result: NoteGroupPermissionWithResultForUser[] = [];
    for (const group0 of noteGroupPermissions[0]) {
      for (const group1 of noteGroupPermissions[1]) {
        for (const group2 of noteGroupPermissions[2]) {
          for (const group3 of noteGroupPermissions[3]) {
            for (const group4 of noteGroupPermissions[4]) {
              const insert: NoteGroupPermission[] = [];
              let readPermission = false;
              let writePermission = false;
              if (group0 !== null) {
                // user1 in ReadGroups
                readPermission = true;
                insert.push(group0);
              }
              if (group1 !== null) {
                // user1 in WriteGroups
                readPermission = true;
                writePermission = true;
                insert.push(group1);
              }

              if (group2 !== null) {
                if (everyoneDefaultPermission === DefaultAccessLevel.WRITE) {
                  writePermission = writePermission || group2.canEdit;
                  readPermission = true;
                } else if (
                  everyoneDefaultPermission === DefaultAccessLevel.READ
                ) {
                  readPermission = true;
                }
                insert.push(group2);
              }
              if (group3 !== null) {
                // loggedIn users
                readPermission = true;
                writePermission = writePermission || group3.canEdit;
                insert.push(group3);
              }
              if (group4 !== null) {
                // user not in group
                insert.push(group4);
              }
              result.push({
                permissions: insert,
                allowsRead: readPermission,
                allowsWrite: writePermission,
              });
            }
          }
        }
      }
    }
    return result;
  }

  // inspired by https://stackoverflow.com/questions/9960908/permutations-in-javascript
  function permutator<T>(inputArr: T[]): T[][] {
    const results: T[][] = [];

    function permute(arr: T[], memo: T[]): T[][] {
      let cur: T[];

      for (let i = 0; i < arr.length; i++) {
        cur = arr.splice(i, 1);
        if (arr.length === 0) {
          results.push(memo.concat(cur));
        }
        permute(arr.slice(), memo.concat(cur));
        arr.splice(i, 0, cur[0]);
      }

      return results;
    }

    return permute(inputArr, []);
  }

  // takes each set of permissions from createNoteGroupPermissionsCombinations, permute them and add them to the list
  function permuteNoteGroupPermissions(
    noteGroupPermissions: NoteGroupPermissionWithResultForUser[],
  ): NoteGroupPermissionWithResultForUser[] {
    const result: NoteGroupPermissionWithResultForUser[] = [];
    for (const permission of noteGroupPermissions) {
      const permutations = permutator(permission.permissions);
      for (const permutation of permutations) {
        result.push({
          permissions: permutation,
          allowsRead: permission.allowsRead,
          allowsWrite: permission.allowsWrite,
        });
      }
    }
    return result;
  }

  describe('check if groups work with', () => {
    const rawPermissions = createNoteGroupPermissionsCombinations(
      DefaultAccessLevel.WRITE,
    );
    const permissions = permuteNoteGroupPermissions(rawPermissions);
    let i = 0;
    for (const permission of permissions) {
      const note = createNote(user2);
      note.groupPermissions = Promise.resolve(permission.permissions);
      let permissionString = '';
      for (const perm of permission.permissions) {
        permissionString += ` ${perm.id}:${String(perm.canEdit)}`;
      }
      it(`mayWrite - test #${i}:${permissionString}`, async () => {
        expect(await service.mayWrite(user1, note)).toEqual(
          permission.allowsWrite,
        );
      });
      it(`mayRead - test #${i}:${permissionString}`, async () => {
        expect(await service.mayRead(user1, note)).toEqual(
          permission.allowsRead,
        );
      });
      i++;
    }
  });

  describe('mayCreate', () => {
    it('allows creation for logged in', () => {
      expect(service.mayCreate(user1)).toBeTruthy();
    });
    it('allows creation of notes for guests with permission', () => {
      noteMockConfig.guestAccess = GuestAccess.CREATE;
      noteMockConfig.permissions.default.loggedIn = DefaultAccessLevel.WRITE;
      noteMockConfig.permissions.default.everyone = DefaultAccessLevel.WRITE;
      expect(service.mayCreate(null)).toBeTruthy();
    });
    it('denies creation of notes for guests without permission', () => {
      noteMockConfig.guestAccess = GuestAccess.WRITE;
      noteMockConfig.permissions.default.loggedIn = DefaultAccessLevel.WRITE;
      noteMockConfig.permissions.default.everyone = DefaultAccessLevel.WRITE;
      expect(service.mayCreate(null)).toBeFalsy();
    });
  });

  describe('isOwner works', () => {
    it('for positive case', async () => {
      expect(await service.isOwner(user1, noteNobodyRead)).toBeTruthy();
    });
    it('for negative case', async () => {
      expect(await service.isOwner(user1, noteUser1Read)).toBeFalsy();
    });
  });

  describe('updateNotePermissions', () => {
    const userPermissionUpdate = new NoteUserPermissionUpdateDto();
    userPermissionUpdate.username = 'hardcoded';
    userPermissionUpdate.canEdit = true;
    const groupPermissionUpdate = new NoteGroupPermissionUpdateDto();
    groupPermissionUpdate.groupName = 'testGroup';
    groupPermissionUpdate.canEdit = false;
    const user = User.create(userPermissionUpdate.username, 'Testy') as User;
    const group = Group.create(
      groupPermissionUpdate.groupName,
      groupPermissionUpdate.groupName,
      false,
    ) as Group;
    const note = Note.create(user) as Note;
    it('emits PERMISSION_CHANGE event', async () => {
      const mockedEventEmitter = jest
        .spyOn(eventEmitter, 'emit')
        .mockImplementationOnce((event) => {
          expect(event).toEqual(NoteEvent.PERMISSION_CHANGE);
          return true;
        });
      expect(mockedEventEmitter).not.toHaveBeenCalled();
      await service.updateNotePermissions(note, {
        sharedToUsers: [],
        sharedToGroups: [],
      });
      expect(mockedEventEmitter).toHaveBeenCalled();
    });
    describe('works', () => {
      it('with empty GroupPermissions and with empty UserPermissions', async () => {

        const savedNote = await service.updateNotePermissions(note, {
          sharedToUsers: [],
          sharedToGroups: [],
        });
        expect(await savedNote.userPermissions).toHaveLength(0);
        expect(await savedNote.groupPermissions).toHaveLength(0);
      });
      it('with empty GroupPermissions and with new UserPermissions', async () => {

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        const savedNote = await service.updateNotePermissions(note, {
          sharedToUsers: [userPermissionUpdate],
          sharedToGroups: [],
        });
        expect(await savedNote.userPermissions).toHaveLength(1);
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(await savedNote.groupPermissions).toHaveLength(0);
      });
      it('with empty GroupPermissions and with existing UserPermissions', async () => {
        const noteWithPreexistingPermissions: Note = { ...note };
        noteWithPreexistingPermissions.userPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithPreexistingPermissions),
            user: Promise.resolve(user),
            canEdit: !userPermissionUpdate.canEdit,
          },
        ]);

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        const savedNote = await service.updateNotePermissions(note, {
          sharedToUsers: [userPermissionUpdate],
          sharedToGroups: [],
        });
        expect(await savedNote.userPermissions).toHaveLength(1);
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(await savedNote.groupPermissions).toHaveLength(0);
      });
      it('with new GroupPermissions and with empty UserPermissions', async () => {

        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);
        const savedNote = await service.updateNotePermissions(note, {
          sharedToUsers: [],
          sharedToGroups: [groupPermissionUpdate],
        });
        expect(await savedNote.userPermissions).toHaveLength(0);
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
      it('with new GroupPermissions and with new UserPermissions', async () => {

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);
        const savedNote = await service.updateNotePermissions(note, {
          sharedToUsers: [userPermissionUpdate],
          sharedToGroups: [groupPermissionUpdate],
        });
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
      it('with new GroupPermissions and with existing UserPermissions', async () => {
        const noteWithUserPermission: Note = { ...note };
        noteWithUserPermission.userPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithUserPermission),
            user: Promise.resolve(user),
            canEdit: !userPermissionUpdate.canEdit,
          },
        ]);

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);
        const savedNote = await service.updateNotePermissions(
          noteWithUserPermission,
          {
            sharedToUsers: [userPermissionUpdate],
            sharedToGroups: [groupPermissionUpdate],
          },
        );
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
      it('with existing GroupPermissions and with empty UserPermissions', async () => {
        const noteWithPreexistingPermissions: Note = { ...note };
        noteWithPreexistingPermissions.groupPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithPreexistingPermissions),
            group: Promise.resolve(group),
            canEdit: !groupPermissionUpdate.canEdit,
          },
        ]);
        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);

        const savedNote = await service.updateNotePermissions(
          noteWithPreexistingPermissions,
          {
            sharedToUsers: [],
            sharedToGroups: [groupPermissionUpdate],
          },
        );
        expect(await savedNote.userPermissions).toHaveLength(0);
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
      it('with existing GroupPermissions and with new UserPermissions', async () => {
        const noteWithPreexistingPermissions: Note = { ...note };
        noteWithPreexistingPermissions.groupPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithPreexistingPermissions),
            group: Promise.resolve(group),
            canEdit: !groupPermissionUpdate.canEdit,
          },
        ]);

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);
        const savedNote = await service.updateNotePermissions(
          noteWithPreexistingPermissions,
          {
            sharedToUsers: [userPermissionUpdate],
            sharedToGroups: [groupPermissionUpdate],
          },
        );
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
      it('with existing GroupPermissions and with existing UserPermissions', async () => {
        const noteWithPreexistingPermissions: Note = { ...note };
        noteWithPreexistingPermissions.groupPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithPreexistingPermissions),
            group: Promise.resolve(group),
            canEdit: !groupPermissionUpdate.canEdit,
          },
        ]);
        noteWithPreexistingPermissions.userPermissions = Promise.resolve([
          {
            id: 1,
            note: Promise.resolve(noteWithPreexistingPermissions),
            user: Promise.resolve(user),
            canEdit: !userPermissionUpdate.canEdit,
          },
        ]);

        jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(user);
        jest.spyOn(groupRepo, 'findOne').mockResolvedValueOnce(group);
        const savedNote = await service.updateNotePermissions(
          noteWithPreexistingPermissions,
          {
            sharedToUsers: [userPermissionUpdate],
            sharedToGroups: [groupPermissionUpdate],
          },
        );
        expect(
          (await (await savedNote.userPermissions)[0].user).username,
        ).toEqual(userPermissionUpdate.username);
        expect((await savedNote.userPermissions)[0].canEdit).toEqual(
          userPermissionUpdate.canEdit,
        );
        expect(
          (await (await savedNote.groupPermissions)[0].group).name,
        ).toEqual(groupPermissionUpdate.groupName);
        expect((await savedNote.groupPermissions)[0].canEdit).toEqual(
          groupPermissionUpdate.canEdit,
        );
      });
    });
    describe('fails:', () => {
      it('userPermissions has duplicate entries', async () => {
        await expect(
          service.updateNotePermissions(note, {
            sharedToUsers: [userPermissionUpdate, userPermissionUpdate],
            sharedToGroups: [],
          }),
        ).rejects.toThrow(PermissionsUpdateInconsistentError);
      });

      it('groupPermissions has duplicate entries', async () => {
        await expect(
          service.updateNotePermissions(note, {
            sharedToUsers: [],
            sharedToGroups: [groupPermissionUpdate, groupPermissionUpdate],
          }),
        ).rejects.toThrow(PermissionsUpdateInconsistentError);
      });

      it('userPermissions and groupPermissions have duplicate entries', async () => {
        await expect(
          service.updateNotePermissions(note, {
            sharedToUsers: [userPermissionUpdate, userPermissionUpdate],
            sharedToGroups: [groupPermissionUpdate, groupPermissionUpdate],
          }),
        ).rejects.toThrow(PermissionsUpdateInconsistentError);
      });
    });
  });

  describe('setUserPermission', () => {
    it('emits PERMISSION_CHANGE event', async () => {
      const note = Note.create(null) as Note;
      const user = User.create('test', 'Testy') as User;
      const mockedEventEmitter = jest
        .spyOn(eventEmitter, 'emit')
        .mockImplementationOnce((event) => {
          expect(event).toEqual(NoteEvent.PERMISSION_CHANGE);
          return true;
        });
      expect(mockedEventEmitter).not.toHaveBeenCalled();
      await service.setUserPermission(note, user, true);
      expect(mockedEventEmitter).toHaveBeenCalled();
    });
    describe('works', () => {
      it('with user not added before and editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        const resultNote = await service.setUserPermission(note, user, true);
        const noteUserPermission = NoteUserPermission.create(user, note, true);
        expect((await resultNote.userPermissions)[0]).toStrictEqual(
          noteUserPermission,
        );
      });
      it('with user not added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        const resultNote = await service.setUserPermission(note, user, false);
        const noteUserPermission = NoteUserPermission.create(user, note, false);
        expect((await resultNote.userPermissions)[0]).toStrictEqual(
          noteUserPermission,
        );
      });
      it('with user added before and editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        note.userPermissions = Promise.resolve([
          NoteUserPermission.create(user, note, false),
        ]);

        const resultNote = await service.setUserPermission(note, user, true);
        const noteUserPermission = NoteUserPermission.create(user, note, true);
        expect((await resultNote.userPermissions)[0]).toStrictEqual(
          noteUserPermission,
        );
      });
      it('with user added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        note.userPermissions = Promise.resolve([
          NoteUserPermission.create(user, note, true),
        ]);
        const resultNote = await service.setUserPermission(note, user, false);
        const noteUserPermission = NoteUserPermission.create(user, note, false);
        expect((await resultNote.userPermissions)[0]).toStrictEqual(
          noteUserPermission,
        );
      });
    });
  });

  describe('removeUserPermission', () => {
    it('emits PERMISSION_CHANGE event', async () => {
      const note = Note.create(null) as Note;
      const user = User.create('test', 'Testy') as User;
      note.userPermissions = Promise.resolve([
        NoteUserPermission.create(user, note, true),
      ]);
      const mockedEventEmitter = jest
        .spyOn(eventEmitter, 'emit')
        .mockImplementationOnce((event) => {
          expect(event).toEqual(NoteEvent.PERMISSION_CHANGE);
          return true;
        });
      expect(mockedEventEmitter).not.toHaveBeenCalled();
      await service.removeUserPermission(note, user);
      expect(mockedEventEmitter).toHaveBeenCalled();
    });
    describe('works', () => {
      it('with user added before and editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        note.userPermissions = Promise.resolve([
          NoteUserPermission.create(user, note, true),
        ]);

        const resultNote = await service.removeUserPermission(note, user);
        expect((await resultNote.userPermissions).length).toStrictEqual(0);
      });
      it('with user not added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const user = User.create('test', 'Testy') as User;
        note.userPermissions = Promise.resolve([
          NoteUserPermission.create(user, note, false),
        ]);
        const resultNote = await service.removeUserPermission(note, user);
        expect((await resultNote.userPermissions).length).toStrictEqual(0);
      });
    });
  });

  describe('setGroupPermission', () => {
    it('emits PERMISSION_CHANGE event', async () => {
      const note = Note.create(null) as Note;
      const group = Group.create('test', 'Testy', false) as Group;
      const mockedEventEmitter = jest
        .spyOn(eventEmitter, 'emit')
        .mockImplementationOnce((event) => {
          expect(event).toEqual(NoteEvent.PERMISSION_CHANGE);
          return true;
        });
      expect(mockedEventEmitter).not.toHaveBeenCalled();
      await service.setGroupPermission(note, group, true);
      expect(mockedEventEmitter).toHaveBeenCalled();
    });
    describe('works', () => {
      it('with group not added before and editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        const resultNote = await service.setGroupPermission(note, group, true);
        const noteGroupPermission = NoteGroupPermission.create(
          group,
          note,
          true,
        );
        expect((await resultNote.groupPermissions)[0]).toStrictEqual(
          noteGroupPermission,
        );
      });
      it('with group not added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        const resultNote = await service.setGroupPermission(note, group, false);
        const noteGroupPermission = NoteGroupPermission.create(
          group,
          note,
          false,
        );
        expect((await resultNote.groupPermissions)[0]).toStrictEqual(
          noteGroupPermission,
        );
      });
      it('with group added before and editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        note.groupPermissions = Promise.resolve([
          NoteGroupPermission.create(group, note, false),
        ]);

        const resultNote = await service.setGroupPermission(note, group, true);
        const noteGroupPermission = NoteGroupPermission.create(
          group,
          note,
          true,
        );
        expect((await resultNote.groupPermissions)[0]).toStrictEqual(
          noteGroupPermission,
        );
      });
      it('with group added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        note.groupPermissions = Promise.resolve([
          NoteGroupPermission.create(group, note, true),
        ]);
        const resultNote = await service.setGroupPermission(note, group, false);
        const noteGroupPermission = NoteGroupPermission.create(
          group,
          note,
          false,
        );
        expect((await resultNote.groupPermissions)[0]).toStrictEqual(
          noteGroupPermission,
        );
      });
    });
  });

  describe('removeGroupPermission', () => {
    it('emits PERMISSION_CHANGE event', async () => {
      const note = Note.create(null) as Note;
      const group = Group.create('test', 'Testy', false) as Group;
      note.groupPermissions = Promise.resolve([
        NoteGroupPermission.create(group, note, true),
      ]);
      const mockedEventEmitter = jest
        .spyOn(eventEmitter, 'emit')
        .mockImplementationOnce((event) => {
          expect(event).toEqual(NoteEvent.PERMISSION_CHANGE);
          return true;
        });
      expect(mockedEventEmitter).not.toHaveBeenCalled();
      await service.removeGroupPermission(note, group);
      expect(mockedEventEmitter).toHaveBeenCalled();
    });
    describe('works', () => {
      it('with user added before and editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        note.groupPermissions = Promise.resolve([
          NoteGroupPermission.create(group, note, true),
        ]);

        const resultNote = await service.removeGroupPermission(note, group);
        expect((await resultNote.groupPermissions).length).toStrictEqual(0);
      });
      it('with user not added before and not editable', async () => {

        const note = Note.create(null) as Note;
        const group = Group.create('test', 'Testy', false) as Group;
        note.groupPermissions = Promise.resolve([
          NoteGroupPermission.create(group, note, false),
        ]);
        const resultNote = await service.removeGroupPermission(note, group);
        expect((await resultNote.groupPermissions).length).toStrictEqual(0);
      });
    });
  });

  describe('changeOwner', () => {
    it('works', async () => {
      const note = Note.create(null) as Note;
      const user = User.create('test', 'Testy') as User;

      const resultNote = await service.changeOwner(note, user);
      expect(await resultNote.owner).toStrictEqual(user);
    });
  });
});
