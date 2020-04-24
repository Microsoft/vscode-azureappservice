/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import moment = require("moment");
import { IActionContext } from "vscode-azureextensionui";
import { timeFormat } from "../../constants";
import { SiteTreeItem } from "../../explorer/SiteTreeItem";
import { localize } from "../../localize";
import { requestUtils } from "../../utils/requestUtils";
import { findTableByName, getValuesByColumnName } from "./parseDetectorResponse";

export enum ColumnName {
    status = "Status",
    message = "Message",
    name = "Name",
    value = "Value",
    expanded = "Expanded",
    solutions = "Solutions",
    time = "Time",
    instance = "Instance",
    facility = "Facility",
    failureCount = "FailureCount",
    dataValue = 'Data.Value',
    dataName = 'Data.Name'
}
export async function getLinuxDetectorError(context: IActionContext, detectorId: string, node: SiteTreeItem, startTime: string, endTime: string, deployEndTime: string): Promise<string | undefined> {
    const detectorUri: string = `${node.id}/detectors/${detectorId}`;
    const requestOptions: requestUtils.Request = await requestUtils.getDefaultAzureRequest(detectorUri, node.root);

    requestOptions.qs = {
        'api-version': "2015-08-01",
        startTime,
        endTime,
        // query param to return plain text rather than html
        logFormat: 'plain'
    };

    const detectorResponse: string = await requestUtils.sendRequest<string>(requestOptions);
    const responseJson: detectorResponseJSON = <detectorResponseJSON>JSON.parse(detectorResponse);

    const insightLogTable: detectorTable | undefined = findTableByName(responseJson.properties.dataset, 'insight/logs');

    if (!insightLogTable) {
        return undefined;
    }

    const rawApplicationLog: string = getValuesByColumnName(context, insightLogTable, ColumnName.value);
    const insightDataset: detectorDataset[] = <detectorDataset[]>JSON.parse(rawApplicationLog);

    let insightTable: detectorTable;
    let detectorTimestamp: string;

    // [1] 2020-04-21T18:23:50 is the format of the timestamp in the insight response, this RegExp will remove the brackets
    const bracketsAndSpace: RegExp = /\[.*?\]\s/;
    const appInsightTable: detectorTable | undefined = findTableByName(insightDataset, 'application/insight');
    if (appInsightTable) {
        insightTable = appInsightTable;
        context.telemetry.properties.insight = 'app';
        detectorTimestamp = getValuesByColumnName(context, appInsightTable, ColumnName.dataName).replace(bracketsAndSpace, '');
    } else {
        // if there are no app insights, defer to the Docker container
        const dockerInsightTable: detectorTable | undefined = findTableByName(insightDataset, 'docker/insight');
        if (!dockerInsightTable) {
            return undefined;
        }

        insightTable = dockerInsightTable;
        context.telemetry.properties.insight = 'docker';
        detectorTimestamp = getValuesByColumnName(context, dockerInsightTable, ColumnName.dataName).replace(bracketsAndSpace, '');
    }

    detectorTimestamp = moment.utc(detectorTimestamp).format(timeFormat);

    if (!detectorTimestamp || !validateTimestamp(context, detectorTimestamp, deployEndTime)) {
        return undefined;
    }

    if (getValuesByColumnName(context, insightTable, ColumnName.status) === 'Critical') {
        const insightError: string = getValuesByColumnName(context, insightTable, ColumnName.dataValue);
        context.telemetry.properties.errorMessages = JSON.stringify(insightError);
        return localize('criticalError', '"{0}" reported a critical error: {1}', node.root.client.siteName, insightError);
    }

    return undefined;
}

export function validateTimestamp(context: IActionContext, detectorTime: string, deployResultTime: string): boolean {
    const secondsBetweenTimes: number = Math.abs((new Date(detectorTime).getTime() - new Date(deployResultTime).getTime()) / 1000);

    // the log timestamp is typically ~20 seconds after the deployResult time
    context.telemetry.properties.timeBetweenDeployAndDetector = secondsBetweenTimes.toString();
    if (secondsBetweenTimes <= 60) {
        return true;
    }

    context.telemetry.properties.invalidTimestamp = 'true';
    return false;
}

export type detectorResponseJSON = {
    properties: {
        dataset: detectorDataset[]
    }
};

export type detectorDataset = {
    table: detectorTable
};

export type detectorTable = {
    tableName: string,
    columns: detectorColumn[],
    rows: string[]
};

type detectorColumn = {
    columnName: ColumnName,
    dataType: string,
    columnType: string
};
