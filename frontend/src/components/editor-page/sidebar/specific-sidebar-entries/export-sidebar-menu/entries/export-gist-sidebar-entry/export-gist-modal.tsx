/*
 * SPDX-FileCopyrightText: 2024 The HedgeDoc developers (see AUTHORS file)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import React, { useCallback, useMemo, useState } from 'react'
import type { ModalVisibilityProps } from '../../../../../../common/modals/common-modal'
import { CommonModal } from '../../../../../../common/modals/common-modal'
import { Button, FormCheck, FormControl, FormGroup, FormLabel, FormText, Modal } from 'react-bootstrap'
import { useNoteMarkdownContent } from '../../../../../../../hooks/common/use-note-markdown-content'
import { useNoteFilename } from '../../../../../../../hooks/common/use-note-filename'
import { useOnInputChange } from '../../../../../../../hooks/common/use-on-input-change'
import { Github } from 'react-bootstrap-icons'
import { useUiNotifications } from '../../../../../../notifications/ui-notification-boundary'
import { useTranslatedText } from '../../../../../../../hooks/common/use-translated-text'
import { Trans, useTranslation } from 'react-i18next'
import { ExternalLink } from '../../../../../../common/links/external-link'
import { createGist } from './create-gist'

const GITHUB_CLASSIC_TOKEN_LENGTH = 40
const GITHUB_CLASSIC_TOKEN_PREFIX = 'ghp_'
const GITHUB_SCOPED_TOKEN_LENGTH = 93
const GITHUB_SCOPED_TOKEN_PREFIX = 'github_pat_'

/**
 * Renders the modal for exporting the note content to a GitHub Gist.
 *
 * @param show true to show the modal, false otherwise.
 * @param onHide Callback that is fired when the modal is about to be closed.
 */
export const ExportGistModal: React.FC<ModalVisibilityProps> = ({ show, onHide }) => {
  useTranslation()
  const noteContent = useNoteMarkdownContent()
  const noteFilename = useNoteFilename()
  const { dispatchUiNotification, showErrorNotification } = useUiNotifications()
  const textModalTitle = useTranslatedText('editor.export.gist.title')
  const textNotificationButton = useTranslatedText('editor.export.gist.notificationSuccessButton')
  const textFieldPublic = useTranslatedText('editor.export.gist.fieldPublic')

  const [ghToken, setGhToken] = useState('')
  const [gistDescription, setGistDescription] = useState('')
  const [gistPublic, setGistPublic] = useState(false)

  const onGistDescriptionChange = useOnInputChange(setGistDescription)
  const onGhTokenChange = useOnInputChange(setGhToken)
  const onGistPublicChange = useCallback(() => setGistPublic((prev) => !prev), [])

  const ghTokenFormatValid = useMemo(() => {
    return (
      (ghToken.startsWith(GITHUB_CLASSIC_TOKEN_PREFIX) && ghToken.length === GITHUB_CLASSIC_TOKEN_LENGTH) ||
      (ghToken.startsWith(GITHUB_SCOPED_TOKEN_PREFIX) && ghToken.length === GITHUB_SCOPED_TOKEN_LENGTH)
    )
  }, [ghToken])

  const onCreateGist = useCallback(() => {
    createGist(ghToken, noteContent, noteFilename, gistDescription, gistPublic)
      .then((gistUrl) => {
        dispatchUiNotification(
          'editor.export.gist.notificationSuccessTitle',
          'editor.export.gist.notificationSuccessMessage',
          {
            durationInSecond: 30,
            icon: Github,
            buttons: [{ label: textNotificationButton, onClick: () => window.open(gistUrl, '_blank') }]
          }
        )
        onHide?.()
      })
      .catch(showErrorNotification('editor.export.gist.notificationErrorTitle', {}, true))
  }, [
    onHide,
    ghToken,
    gistDescription,
    gistPublic,
    noteContent,
    noteFilename,
    dispatchUiNotification,
    showErrorNotification,
    textNotificationButton
  ])

  return (
    <CommonModal show={show} onHide={onHide} title={textModalTitle} showCloseButton={true} titleIcon={Github}>
      <Modal.Body>
        <h5 className={'mb-2'}>
          <Trans i18nKey={'editor.export.gist.headingAuthentication'} />
        </h5>
        <FormGroup className={'my-2'}>
          <FormLabel>
            <Trans i18nKey={'editor.export.gist.fieldToken'} />
          </FormLabel>
          <FormControl value={ghToken} onChange={onGhTokenChange} type={'password'} isInvalid={!ghTokenFormatValid} />
          <FormText muted={true}>
            <Trans i18nKey={'editor.export.gist.infoToken'} />{' '}
            <ExternalLink
              text={'https://github.com/settings/personal-access-tokens/new'}
              href={'https://github.com/settings/personal-access-tokens/new'}
            />
          </FormText>
        </FormGroup>
        <h5 className={'mb-2 mt-4'}>
          <Trans i18nKey={'editor.export.gist.headingSettings'} />
        </h5>
        <FormGroup className={'my-2'}>
          <FormLabel>
            <Trans i18nKey={'editor.export.gist.fieldDescription'} />
          </FormLabel>
          <FormControl value={gistDescription} onChange={onGistDescriptionChange} type={'text'} />
        </FormGroup>
        <FormGroup className={'mt-2'}>
          <FormCheck checked={gistPublic} onChange={onGistPublicChange} type={'checkbox'} label={textFieldPublic} />
        </FormGroup>
      </Modal.Body>
      <Modal.Footer>
        <Button variant={'success'} onClick={onCreateGist} disabled={!ghTokenFormatValid}>
          <Trans i18nKey={'editor.export.gist.createButton'} />
        </Button>
      </Modal.Footer>
    </CommonModal>
  )
}
