/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteConfigResource } from 'azure-arm-website/lib/models';
import * as vscode from 'vscode';
import { SiteClient } from 'vscode-azureappservice';
import { IActionContext } from 'vscode-azureextensionui';
import { SiteTreeItem } from '../../explorer/SiteTreeItem';
import { WebAppTreeItem } from '../../explorer/WebAppTreeItem';
import { ext } from '../../extensionVariables';
import * as remoteDebug from './remoteDebugCommon';

export async function stopRemoteDebug(context: IActionContext, node?: SiteTreeItem): Promise<void> {
    if (!node) {
        node = <SiteTreeItem>await ext.tree.showTreeItemPicker(WebAppTreeItem.contextValue, context);
    }
    const siteClient: SiteClient = node.root.client;

    const confirmMessage: string = 'The app configuration will be updated to disable remote debugging and restarted. Would you like to continue?';
    const noopMessage: string = 'The app is not configured for debugging.';

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress: vscode.Progress<{}>): Promise<void> => {
        remoteDebug.reportMessage('Fetching site configuration...', progress);
        const siteConfig: SiteConfigResource = await siteClient.getSiteConfig();

        remoteDebug.checkForRemoteDebugSupport(siteConfig, context);

        await remoteDebug.setRemoteDebug(false, confirmMessage, noopMessage, siteClient, siteConfig, progress, remoteDebug.remoteDebugLink);
    });
}
