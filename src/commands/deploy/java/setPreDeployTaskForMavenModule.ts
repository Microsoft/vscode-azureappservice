/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import { TaskDefinition } from 'vscode';
import { IDeployContext } from 'vscode-azureappservice';
import * as constants from '../../../constants';
import { getWorkspaceSetting, updateWorkspaceSetting } from '../../../vsCodeConfig/settings';
import * as tasks from '../../../vsCodeConfig/tasks';

export async function setPreDeployTaskForMavenModule(context: IDeployContext, module: { pom: string, artifactId: string }): Promise<void> {
    const preDeployTaskKey: string = 'preDeployTask';
    const workspaceFspath: string = context.workspaceFolder.uri.fsPath;
    const mavenPackageTaskName: string = `package:${module.artifactId}`;

    if (getWorkspaceSetting<string>(preDeployTaskKey, workspaceFspath)) {
        return;
    }

    const existingTasks: tasks.ITask[] = tasks.getTasks(context.workspaceFolder);
    let packageTask: tasks.ITask | undefined = existingTasks.find(t1 => t1.label === mavenPackageTaskName);
    if (!packageTask) {
        packageTask = await generateMavenPackageTask(path.dirname(module.pom), mavenPackageTaskName);
        await tasks.updateTasks(context.workspaceFolder, existingTasks.concat([packageTask]));
    }

    const currentVersion: string | undefined = tasks.getTasksVersion(context.workspaceFolder);
    if (!currentVersion) {
        await tasks.updateTasksVersion(context.workspaceFolder, tasks.tasksVersion);
    }

    await updateWorkspaceSetting(preDeployTaskKey, mavenPackageTaskName, workspaceFspath);
}

async function generateMavenPackageTask(moduleFolder: string, taskName: string): Promise<TaskDefinition> {
    const mvnWrapperName = constants.isWindows ? "./mvnw.cmd" : "./mvnw";
    const mvnWrapper = await getLocalMavenWrapper(moduleFolder);
    const cmd = mvnWrapper ? mvnWrapperName : 'mvn';
    const cwd = mvnWrapper ? path.dirname(mvnWrapper) : moduleFolder;
    const relativeModulePath: string = path.dirname(path.relative(cwd, moduleFolder));
    const pomPath: string = path.posix.join(relativeModulePath, 'pom.xml');

    return {
        label: taskName,
        command: cmd,
        type: "shell",
        group: "build",
        args: ["clean", "package", "-f", pomPath],
        options: { cwd },
        presentation: {
            echo: true,
            reveal: "always",
            focus: false,
            panel: "shared",
            showReuseMessage: true,
            clear: false
        },
        problemMatcher: "$msCompile",
    };
}

async function getLocalMavenWrapper(modulePath: string): Promise<string | undefined> {
    const mvnw: string = constants.isWindows ? "mvnw.cmd" : "mvnw";
    // walk up parent folders
    let current: string = modulePath;
    while (path.basename(current)) {
        const potentialMvnwPath: string = path.join(current, mvnw);
        if (await fse.pathExists(potentialMvnwPath)) {
            return potentialMvnwPath;
        }
        current = path.dirname(current);
    }
    return undefined;
}
