/*
 * SPDX-FileCopyrightText: 2024 The HedgeDoc developers (see AUTHORS file)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { SidebarButton } from '../../sidebar-button/sidebar-button'
import { SidebarMenu } from '../../sidebar-menu/sidebar-menu'
import type { SpecificSidebarMenuProps } from '../../types'
import { DocumentSidebarMenuSelection } from '../../types'
import React, { Fragment, useCallback } from 'react'
import { ArrowLeft as IconArrowLeft, Images as IconImages } from 'react-bootstrap-icons'
import { Trans, useTranslation } from 'react-i18next'

/**
 * Renders the import menu for the sidebar.
 *
 * @param className Additional class names given to the menu button
 * @param menuId The id of the menu
 * @param onClick The callback, that should be called when the menu button is pressed
 * @param selectedMenuId The currently selected menu id
 */
export const MediaBrowserSidebarMenu: React.FC<SpecificSidebarMenuProps> = ({
  className,
  menuId,
  onClick,
  selectedMenuId
}) => {
  useTranslation()

  const hide = selectedMenuId !== DocumentSidebarMenuSelection.NONE && selectedMenuId !== menuId
  const expand = selectedMenuId === menuId
  const onClickHandler = useCallback(() => {
    onClick(menuId)
  }, [menuId, onClick])

  return (
    <Fragment>
      <SidebarButton
        hide={hide}
        icon={expand ? IconArrowLeft : IconImages}
        className={className}
        onClick={onClickHandler}>
        <Trans i18nKey={'editor.mediaBrowser.title'} />
      </SidebarButton>
      <SidebarMenu expand={expand}>
        <span>MEDIA!</span>
      </SidebarMenu>
    </Fragment>
  )
}
