/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import moment = require("moment");
import { CancellationTokenSource } from "vscode";
import { createKuduClient } from "vscode-azureappservice";
import { callWithTelemetryAndErrorHandling, IActionContext, openInPortal, UserCancelledError } from "vscode-azureextensionui";
import { KuduClient, KuduModels } from "vscode-azurekudu";
import { detectorTimestampFormat } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from "../../localize";
import { SiteTreeItem } from "../../tree/SiteTreeItem";
import { delay } from "../../utils/delay";
import { getLinuxDetectorError } from "./getLinuxDetectorError";

const linuxLogViewer: string = 'LinuxLogViewer';

export async function checkLinuxWebAppDownDetector(originalContext: IActionContext, correlationId: string, node: SiteTreeItem, tokenSource: CancellationTokenSource): Promise<void> {
    return await callWithTelemetryAndErrorHandling('linuxWebAppDownDetector', async (context: IActionContext): Promise<void> => {
        context.errorHandling.suppressDisplay = true;
        context.valuesToMask.push(...originalContext.valuesToMask);
        context.telemetry.properties.correlationId = correlationId;

        const kuduClient: KuduClient = await createKuduClient(context, node.root.client);
        const deployment: KuduModels.DeployResult = await kuduClient.deployment.getResult('latest');

        if (!deployment.endTime) {
            // if there's no deployment detected, nothing can be done
            context.telemetry.properties.lastStep = 'noDeployResult';
            return;
        }

        let detectorErrorMessage: string | undefined;
        const detectorTimeoutMs: number = Date.now() + 5 * 60 * 1000;

        while (!detectorErrorMessage) {
            if (tokenSource.token.isCancellationRequested) {
                // the user cancelled the check by deploying again
                throw new UserCancelledError('userDeployedAgain');
            }

            if (Date.now() > detectorTimeoutMs) {
                context.telemetry.properties.timedOut = 'true';
                return undefined;
            }

            // There's a requirement (outside the control of the LinuxLogDetector team) that these times have to be less than the current time
            // by 14.5 minutes. That being said, the LinuxLogDetector team ignores the times and always gets the most recent entry.
            // We'll use 30/60 minutes just to make sure we're well over 14.5
            const nowTime: number = Date.now();
            const startTimeDate: Date = new Date(nowTime - (60 * 60 * 1000));
            const endTimeDate: Date = new Date(nowTime - (30 * 60 * 1000));

            const startTime: string = moment.utc(startTimeDate).format(detectorTimestampFormat);
            const endTime: string = moment.utc(endTimeDate).format(detectorTimestampFormat);
            const deployEndTime: string = moment.utc(deployment.endTime).format(detectorTimestampFormat);

            detectorErrorMessage = await getLinuxDetectorError(context, linuxLogViewer, node, startTime, endTime, deployEndTime);

            if (!detectorErrorMessage) {
                // poll every 10 seconds
                await delay(1000 * 10);
            }
        }

        ext.outputChannel.appendLog(detectorErrorMessage);

        void context.ui.showWarningMessage(detectorErrorMessage, { title: localize('viewDetails', 'View details') }).then(async () => {
            await callWithTelemetryAndErrorHandling('viewedDetectorDetails', async (context2: IActionContext) => {
                context2.valuesToMask.push(...originalContext.valuesToMask);
                context2.telemetry.properties.viewed = 'true';
                await openInPortal(node.root, `${node.root.client.id}/troubleshoot`, { queryPrefix: `websitesextension_ext=asd.featurePath%3Ddetectors%2F${linuxLogViewer}` });
            });
        });
    });
}
