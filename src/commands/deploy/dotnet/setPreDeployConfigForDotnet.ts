/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import { MessageItem, TaskDefinition } from 'vscode';
import { IDeployContext } from 'vscode-azureappservice';
import * as constants from '../../../constants';
import { localize } from '../../../localize';
import { updateWorkspaceSetting } from '../../../vsCodeConfig/settings';
import * as tasks from '../../../vsCodeConfig/tasks';

const cleanId: string = 'clean';
const publishId: string = 'publish-release';

export async function setPreDeployConfigForDotnet(context: IDeployContext, csprojFile: string): Promise<void> {
    const workspaceFspath: string = context.workspaceFolder.uri.fsPath;

    const targetFramework: string | undefined = await tryGetTargetFramework(csprojFile);
    context.telemetry.properties.tfw = targetFramework ? targetFramework : 'N/A';

    if (!targetFramework) {
        // if the target framework cannot be found, don't try to set defaults
        return;
    }

    const notConfiguredForDeploy: string = localize('requiredConfig', 'Required configuration to deploy is missing from "{0}".', context.workspaceFolder.name);
    const addConfigButton: MessageItem = { title: localize('addConfig', "Add Config") };
    await context.ui.showWarningMessage(notConfiguredForDeploy, { modal: true, stepName: 'dotnetDeployConfig' }, addConfigButton);

    // resolves to "."if it is not a subfolder
    const subfolder: string = path.dirname(path.relative(workspaceFspath, csprojFile));

    // always use posix for debug config because it's committed to source control and works on all OS's
    const deploySubpath: string = path.posix.join(subfolder, 'bin', 'Release', targetFramework, 'publish');

    await updateWorkspaceSetting(constants.configurationSettings.preDeployTask, publishId, workspaceFspath);
    await updateWorkspaceSetting(constants.configurationSettings.deploySubpath, deploySubpath, workspaceFspath);

    // update the deployContext.effectiveDeployPath with the .NET output path since getDeployFsPath is called prior to this
    context.effectiveDeployFsPath = path.join(workspaceFspath, deploySubpath);

    const existingTasks: tasks.ITask[] = tasks.getTasks(context.workspaceFolder);
    const publishTask: tasks.ITask | undefined = existingTasks.find(t1 => {
        return t1.label === publishId;
    });

    if (publishTask) {
        // if the "publish" task exists and it doesn't dependOn a task, have it depend on clean
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        publishTask.dependsOn = publishTask.dependsOn || cleanId;
    }

    // do not overwrite any dotnet tasks the user already defined
    let newTasks: tasks.ITask[] = generateDotnetTasks(subfolder);
    newTasks = newTasks.filter(t1 => !existingTasks.find(t2 => {
        return t1.label === t2.label;
    }));

    const currentVersion: string | undefined = tasks.getTasksVersion(context.workspaceFolder);
    if (!currentVersion) {
        await tasks.updateTasksVersion(context.workspaceFolder, tasks.tasksVersion);
    }

    await tasks.updateTasks(context.workspaceFolder, existingTasks.concat(newTasks));
}

async function tryGetTargetFramework(projFilePath: string): Promise<string | undefined> {
    const projContents: string = (await fse.readFile(projFilePath)).toString();
    const matches: RegExpMatchArray | null = projContents.match(/<TargetFramework>(.*)<\/TargetFramework>/);
    return matches === null ? undefined : matches[1];
}

function generateDotnetTasks(subfolder: string): TaskDefinition[] {
    // always use posix for debug config because it's committed to source control and works on all OS's
    const cwd: string = path.posix.join('${workspaceFolder}', subfolder);

    const cleanTask: TaskDefinition = {
        label: cleanId,
        command: "dotnet",
        type: "process",
        args: [
            'clean',
            cwd,
            "/property:GenerateFullPaths=true",
            "/consoleloggerparameters:NoSummary"
        ],
        problemMatcher: "$msCompile"
    };

    const publishTask: TaskDefinition = {
        label: publishId,
        command: "dotnet",
        type: "process",
        args: [
            'publish',
            cwd,
            '--configuration',
            'Release',
            "/property:GenerateFullPaths=true",
            "/consoleloggerparameters:NoSummary"
        ],
        problemMatcher: "$msCompile",
        dependsOn: cleanId
    };

    return [cleanTask, publishTask];
}
