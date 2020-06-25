/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from 'vscode-azureextensionui';
import { TrialAppTreeItem } from '../../explorer/trialApp/TrialAppTreeItem';
import { WebAppTreeItem } from '../../explorer/WebAppTreeItem';
import { ext } from '../../extensionVariables';
import { localize } from '../../localize';
import { createWebApp } from '../createWebApp/createWebApp';
import { deploy } from '../deploy/deploy';

export async function transferToSubscription(context: IActionContext, node?: TrialAppTreeItem): Promise<void> {
    if (!node) {
        node = ext.azureAccountTreeItem.trialAppNode;
    }

    if (node) {
        const newSite: WebAppTreeItem = await createWebApp(context, undefined, true);
        const settings = await newSite.client.listApplicationSettings();

        // Must set SCM_DO_BUILD_DURING_DEPLOYMENT to '1' for trial apps to successfully deploy
        // tslint:disable-next-line:strict-boolean-expressions
        const properties: { [name: string]: string } = settings.properties || {};
        // tslint:disable-next-line: no-string-literal
        properties['SCM_DO_BUILD_DURING_DEPLOYMENT'] = '1';
        await newSite.client.updateApplicationSettings(settings);

        await deploy(context, newSite, undefined, true);
    } else {
        throw Error(localize('trialAppNotFound', 'Trial app not found.'));
    }
}
