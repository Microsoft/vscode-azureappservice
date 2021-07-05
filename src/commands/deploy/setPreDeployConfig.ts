/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import { IDeployContext } from 'vscode-azureappservice';
import * as constants from '../../constants';
import { isPathEqual } from '../../utils/pathUtils';
import { getWorkspaceSetting } from '../../vsCodeConfig/settings';
import { setPreDeployConfigForDotnet } from './dotnet/setPreDeployConfigForDotnet';
import { tryGetCsprojFile } from './dotnet/tryGetCsprojFile';
import { setPreDeployTaskForMavenModule } from './java/setPreDeployTaskForMavenModule';
import { tryGetMavenModule } from './java/tryGetMavenModule';

export async function setPreDeployConfig(context: IDeployContext): Promise<void> {
    const showPreDeployWarningSetting: string = 'showPreDeployWarning';
    const workspaceFspath: string = context.workspaceFolder.uri.fsPath;

    // don't overwrite preDeploy or deploySubpath if it exists and respect configurePreDeployTasks setting
    if (!getWorkspaceSetting<boolean>(showPreDeployWarningSetting, workspaceFspath)
        || getWorkspaceSetting<string>(constants.configurationSettings.preDeployTask, workspaceFspath)
        || getWorkspaceSetting<string>(constants.configurationSettings.deploySubpath, workspaceFspath)) {
        return;
    }

    const javaMavenModule = tryGetMavenModule(context.effectiveDeployFsPath);
    if (javaMavenModule) {
        await setPreDeployTaskForMavenModule(context, javaMavenModule);
        return;
    }

    // if the user is deploying a different folder than the root, use this folder without setting up defaults
    if (!isPathEqual(context.originalDeployFsPath, workspaceFspath)) {
        return;
    }

    // if the user has a ".deployment" file - assume they've already configured their project's deploy settings
    if (await fse.pathExists(path.join(context.effectiveDeployFsPath, constants.deploymentFileName))) {
        return;
    }

    const csprojFile: string | undefined = await tryGetCsprojFile(context, workspaceFspath);
    if (csprojFile) {
        await setPreDeployConfigForDotnet(context, csprojFile);
    }
}
