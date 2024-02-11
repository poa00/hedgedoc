/*
 * SPDX-FileCopyrightText: 2024 The HedgeDoc developers (see AUTHORS file)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import { initialState } from './initial-state'
import type { HistoryState, RemoveEntryPayload, UpdateEntryPayload } from './types'

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    setEntries: (state, action: PayloadAction<HistoryState>) => {
      return action.payload
    },
    updateEntry: (state, action: PayloadAction<UpdateEntryPayload>) => {
      return state.filter((entry) => entry.identifier !== action.payload.noteId).concat(action.payload.newEntry)
    },
    removeEntry: (state, action: PayloadAction<RemoveEntryPayload>) => {
      return state.filter((entry) => entry.identifier !== action.payload.noteId)
    }
  }
})

export const historyActionsCreator = historySlice.actions
export const historyReducer = historySlice.reducer
