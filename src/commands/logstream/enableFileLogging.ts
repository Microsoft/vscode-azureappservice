/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LogFilesTreeItem } from 'vscode-azureappservice';
import { DialogResponses, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../localize';
import { SiteTreeItem } from "../../tree/SiteTreeItem";
import { WebAppTreeItem } from '../../tree/WebAppTreeItem';

export interface IEnableFileLoggingContext extends IActionContext {
    suppressAlreadyEnabledMessage?: boolean;
}

export async function enableFileLogging(context: IEnableFileLoggingContext, node?: SiteTreeItem | LogFilesTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<SiteTreeItem>(WebAppTreeItem.contextValue, context);
    }

    if (node instanceof LogFilesTreeItem) {
        // If the entry point was the Log Files node, pass the parent as that's where the logic lives
        node = <SiteTreeItem>node.parent;
    }

    const siteNode: SiteTreeItem = node;

    const isEnabled: boolean = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async p => {
        p.report({ message: localize('checkingDiag', 'Checking container diagnostics settings...') });
        return await siteNode.isHttpLogsEnabled();
    });

    if (!isEnabled && siteNode instanceof SiteTreeItem) {
        await context.ui.showWarningMessage(localize('enableLogging', 'Do you want to enable file logging for "{0}"? The web app will be restarted.', siteNode.root.client.fullName), { modal: true, stepName: 'enableFileLogging' }, DialogResponses.yes);
        const enablingLogging: string = localize('enablingLogging', 'Enabling Logging for "{0}"...', siteNode.root.client.fullName);
        const enabledLogging: string = localize('enabledLogging', 'Enabled Logging for "{0}".', siteNode.root.client.fullName);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: enablingLogging }, async (): Promise<void> => {
            ext.outputChannel.appendLog(enablingLogging);
            await siteNode.enableLogs();

            await vscode.commands.executeCommand('appService.Restart', siteNode);
            void vscode.window.showInformationMessage(enabledLogging);
            ext.outputChannel.appendLog(enabledLogging);
        });
    } else if (!context.suppressAlreadyEnabledMessage) {
        void vscode.window.showInformationMessage(localize('loggingEnabled', 'File logging has already been enabled for "{0}".', siteNode.root.client.fullName));
    }
}
