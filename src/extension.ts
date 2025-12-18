import * as vscode from 'vscode';
import * as fs from 'fs';

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
let fileWatcher: vscode.FileSystemWatcher | undefined = undefined;

const LOCALE_FILE_PATTERN = '**/{en,es,fr,de,it,pt,ja,zh,ru}*.json';
const EXCLUDE_PATTERN = '**/{node_modules,.git,.next,build,dist,out}/**';

export async function activate(context: vscode.ExtensionContext) {
    await findAndLoadPrimaryTranslationFile();

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

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('i18nGhostLens.localePath')) {
            findAndLoadPrimaryTranslationFile();
        }
    }));
}

async function findAndLoadPrimaryTranslationFile() {
    const config = vscode.workspace.getConfiguration('i18nGhostLens');
    const manualPath = config.get<string>('localePath');
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) return;
    const rootUri = workspaceFolders[0].uri;

    let targetUri: vscode.Uri | undefined = undefined;

    if (manualPath) {
        const manualUri = vscode.Uri.joinPath(rootUri, manualPath);
        if (fs.existsSync(manualUri.fsPath)) {
            targetUri = manualUri;
        }
    }

    if (!targetUri) {
        const candidates = await vscode.workspace.findFiles(LOCALE_FILE_PATTERN, EXCLUDE_PATTERN, 5);
        if (candidates.length > 0) {
            targetUri = candidates[0];
        }
    }

    if (targetUri) {
        loadTranslationsFromUri(targetUri);
        setupFileWatcher(targetUri);
        triggerUpdate();
    } else {
        translationCache = {};
        triggerUpdate();
    }
}

function loadTranslationsFromUri(uri: vscode.Uri) {
    try {
        const content = fs.readFileSync(uri.fsPath, 'utf-8');
        const json = JSON.parse(content);
        translationCache = flattenObject(json);
    } catch (error) {
        translationCache = {};
    }
}

function setupFileWatcher(uri: vscode.Uri) {
    if (fileWatcher) {
        fileWatcher.dispose();
    }
    fileWatcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
    fileWatcher.onDidChange(() => {
        loadTranslationsFromUri(uri);
        triggerUpdate();
    });
    fileWatcher.onDidDelete(() => {
        findAndLoadPrimaryTranslationFile();
    });
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

    const regex = /t\(['"`]([\w.-]+)['"`]\)/g;
    const text = activeEditor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    let match;
    while ((match = regex.exec(text))) {
        const captureGroup = match[1];
        const translation = translationCache[captureGroup];

        if (translation) {
            const endPos = activeEditor.document.positionAt(match.index + match[0].length);
            const truncate = translation.length > 40 ? translation.substring(0, 37) + '...' : translation;

            decorations.push({
                range: new vscode.Range(endPos, endPos),
                renderOptions: {
                    after: { contentText: `  ➜  ${truncate}` },
                },
            });
        }
    }

    activeEditor.setDecorations(TRANSLATION_DECORATION, decorations);
}

export function deactivate() {
    if (fileWatcher) fileWatcher.dispose();
}