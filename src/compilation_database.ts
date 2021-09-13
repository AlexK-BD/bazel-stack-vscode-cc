import path = require('path');
import * as tmp from 'tmp';
import * as vscode from 'vscode';
import { Container } from './container';

export class CompilationDatabase implements vscode.Disposable {
    disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.commands.registerCommand('bsv.cc.compdb.generate', this.generate, this),
        );
    }

    async generate() {
        const bazel = "bazel";
        const cwd = Container.workspaceFolderFsPath || ".";
        const config = vscode.workspace.getConfiguration('bsv.cc.compdb');
        const targets = config.get<string[] | undefined>('targets', undefined);
        if (!targets || targets.length === 0) {
            vscode.window.showErrorMessage('The list of bazel targets to index for the compilation database is not configured.  Please configure the "bsv.cc.compdb.targets" workspace setting to include a list of cc_library, cc_binary labels');
            return;
        }

        vscode.window.showInformationMessage('Building clang compilation database for ' + JSON.stringify(targets));

        const execution = await vscode.tasks.executeTask(new GenerateCompilationDatabaseCommand(
            "bazel-compdb",
            bazel,
            Container.file("compdb/"),
            targets,
            cwd,
            {},
            this.disposables,
        ).newTask());
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}

class GenerateCompilationDatabaseCommand {
    private buildEventsJsonTempFile: string;

    constructor(
        private readonly name: string,
        private readonly bazel: string,
        private readonly repositoryPath: vscode.Uri,
        private readonly targets: string[],
        private readonly cwd: string,
        private readonly env: { [key: string]: string } = {},
        disposables: vscode.Disposable[],
    ) {
        this.buildEventsJsonTempFile = tmp.fileSync().name;

        vscode.window.onDidCloseTerminal(this.handleTerminalClose, this, disposables);
    }

    handleTerminalClose(t: vscode.Terminal) {
        if (t.name !== this.name) {
            return;
        }
        if (t.exitStatus?.code !== 0) {
            return
        }
        vscode.window.showInformationMessage("Complete!");
    }

    makeCommand(): string[] {
        const postprocessPyFile = path.join(this.repositoryPath.fsPath, "postprocess.py")

        let cmd = [
            "build",
            "--override_repository=bazel_vscode_compdb=" + this.repositoryPath.fsPath,
            "--aspects=@bazel_vscode_compdb//:aspects.bzl%compilation_database_aspect",
            "--color=no",
            "--noshow_progress",
            "--noshow_loading_progress",
            "--output_groups=compdb_files,header_files",
            "--build_event_json_file=" + this.buildEventsJsonTempFile,
            ...this.targets,
            "&&",
            postprocessPyFile,
            "-b", this.buildEventsJsonTempFile,
            "&&",
            "rm", this.buildEventsJsonTempFile,
        ];
        return cmd;
    }

    newTask(): vscode.Task {
        const taskDefinition: vscode.TaskDefinition = {
            type: this.name,
        };
        const scope = vscode.TaskScope.Workspace;
        const source = this.name;
        const execution = new vscode.ShellExecution(this.bazel, this.makeCommand(), {
            env: this.env,
            cwd: this.cwd,
        });
        const task = new vscode.Task(taskDefinition, scope, this.name, source, execution);
        task.presentationOptions = {
            clear: true,
            echo: true,
            showReuseMessage: false,
            panel: vscode.TaskPanelKind.Shared,
        };
        return task;
    }
}