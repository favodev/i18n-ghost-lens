import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const TRANSLATION_DECORATION = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 10px',
        color: '#8e96a3aa',
        fontStyle: 'italic',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

let translationCache: Record<string, string> = {};
let activeEditor = vscode.window.activeTextEditor;
let updateTimeout: NodeJS.Timeout | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    reloadTranslations();

    if (activeEditor) triggerUpdate();

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) triggerUpdate();
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdate(true);
        }
    }, null, context.subscriptions);

    const configWatcher = vscode.workspace.createFileSystemWatcher('**/*.json');
    configWatcher.onDidChange(() => {
        reloadTranslations();
        triggerUpdate();
    });
    context.subscriptions.push(configWatcher);
}

function reloadTranslations() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const config = vscode.workspace.getConfiguration('i18nGhostLens');
    const relativePath = config.get<string>('localePath') || 'locales/es.json';
    const absolutePath = path.join(workspaceFolders[0].uri.fsPath, relativePath);

    if (!fs.existsSync(absolutePath)) return;

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const json = JSON.parse(content);
        translationCache = flattenObject(json);
    } catch (error) {
        console.error(error);
    }
}

function flattenObject(obj: any, prefix = ''): Record<string, string> {
    return Object.keys(obj).reduce((acc: any, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        if (typeof obj[k] === 'object' && obj[k] !== null) {
            Object.assign(acc, flattenObject(obj[k], pre + k));
        } else {
            acc[pre + k] = String(obj[k]);
        }
        return acc;
    }, {});
}

function triggerUpdate(throttle = false) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = undefined;
    }
    if (throttle) {
        updateTimeout = setTimeout(updateDecorations, 500);
    } else {
        updateDecorations();
    }
}

function updateDecorations() {
    if (!activeEditor) return;

    const regex = /t\(['"`]([\w.]+)['"`]\)/g;
    const text = activeEditor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    let match;
    while ((match = regex.exec(text))) {
        const captureGroup = match[1];
        const translation = translationCache[captureGroup];

        if (translation) {
            const startPos = activeEditor.document.positionAt(match.index + match[0].length);
            const endPos = activeEditor.document.positionAt(match.index + match[0].length);
            
            const truncate = translation.length > 30 ? translation.substring(0, 27) + '...' : translation;

            decorations.push({
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: `  ➜  ${truncate}` },
                },
            });
        }
    }

    activeEditor.setDecorations(TRANSLATION_DECORATION, decorations);
}

export function deactivate() {}