/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type WizardStatus = 'Completed' | 'Faulted' | 'Cancelled';

export class WizardBase {
    private readonly _steps: WizardStep[] = [];
    private _result: WizardResult;

    protected constructor(protected readonly output: vscode.OutputChannel) {}

    async run(): Promise<WizardResult> {
        // Go through the prompts...
        for (var i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];

            try {
                await this.steps[i].prompt();
            } catch (err) {
                if (err instanceof UserCancelledError) {
                    return {
                        status: 'Cancelled',
                        step: step,
                        error: err
                    };
                }

                return {
                    status: 'Faulted',
                    step: step,
                    error: err
                };
            }
        }

        // Execute each step...
        this.output.show(true);
        for (var i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            
            try {
                this.beforeExecute(step, i);
                await this.steps[i].execute();
            } catch (err) {
                this.onExecuteError(step, i, err);
                if (err instanceof UserCancelledError) {
                    this._result = {
                        status: 'Cancelled',
                        step: step,
                        error: err
                    };
                } else {
                    this._result = {
                        status: 'Faulted',
                        step: step,
                        error: err
                    };
                }
                return this._result;
            }
        }

        this._result = {
            status: 'Completed',
            step: this.steps[this.steps.length - 1],
            error: null
        };

        return this._result;
    }

    get steps(): WizardStep[] {
        return this._steps;
    }

    findStep(predicate: (step: WizardStep) => boolean, errorMessage: string): WizardStep {
        const step = this.steps.find(predicate);
       
        if (!step) {
            throw new Error(errorMessage);
        }

        return step;
    }

    write(text: string) {
        this.output.append(text);
    }

    writeline(text: string) {
        this.output.appendLine(text);
    }

    protected beforeExecute(step: WizardStep, stepIndex: number) {}

    protected onExecuteError(step: WizardStep, stepIndex: number, error: Error) {}
}

export interface WizardResult {
    status: WizardStatus;
    step: WizardStep;
    error: Error;
}

export class WizardStep {
    protected constructor(readonly wizard: WizardBase, readonly stepTitle: string) {}

    async prompt(): Promise<void> {}
    async execute(): Promise<void> {}

    get stepIndex(): number {
        return this.wizard.steps.findIndex(step => step === this);
    }

    get stepProgressText(): string {
        return `Step ${this.stepIndex + 1}/${this.wizard.steps.length}`;
    }

    async showQuickPick(items: vscode.QuickPickItem[], options: vscode.QuickPickOptions, token?: vscode.CancellationToken): Promise<vscode.QuickPickItem> {
        const result = await vscode.window.showQuickPick(items, options, token);

        if (!result) {
            throw new UserCancelledError();
        }

        return result;
    }

    async showInputBox(options?: vscode.InputBoxOptions, token?: vscode.CancellationToken): Promise<string> {
        const result = await vscode.window.showInputBox(options, token);

        if (!result) {
            throw new UserCancelledError();
        }

        return result;
    }
}

export class UserCancelledError extends Error {}
