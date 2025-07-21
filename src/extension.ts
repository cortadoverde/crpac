// src/extension.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCode } from './genkit-flow';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', 'out']);
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.doc', '.docx',
    '.xls', '.xlsx', '.ppt', '.pptx', '.exe', '.dll', '.so', '.o',
    '.mp3', '.mp4', '.mov', '.avi', '.wav', '.mkv', '.woff', '.woff2',
    '.ttf', '.otf', '.eot', '.sqlite', '.db', '.mdb',
]);

async function getAllFileUrisInDirectory(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
    let fileUris: vscode.Uri[] = [];
    try {
        const entries = await fs.promises.readdir(directoryUri.fsPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(directoryUri.fsPath, entry.name);
            const entryUri = vscode.Uri.file(fullPath);
            if (entry.isDirectory()) {
                if (EXCLUDED_DIRS.has(entry.name)) {
                    continue;
                }
                const subDirFiles = await getAllFileUrisInDirectory(entryUri);
                fileUris = fileUris.concat(subDirFiles);
            } else if (entry.isFile()) {
                fileUris.push(entryUri);
            }
        }
    } catch (error) {
        console.error(`Error al leer el directorio ${directoryUri.fsPath}:`, error);
        vscode.window.showWarningMessage(`No se pudo acceder a partes del directorio: ${error instanceof Error ? error.message : String(error)}`);
    }
    return fileUris;
}

async function getFileContent(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
    const stats = fs.statSync(uri.fsPath);

    if (stats.isFile()) {
        const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        const fileExtension = path.extname(uri.fsPath).toLowerCase();
        if (BINARY_EXTENSIONS.has(fileExtension)) {
            return `${relativePath}\n\`\`\`\n[Contenido de archivo binario omitido]\n\`\`\``;
        }
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        return `${relativePath}\n\`\`\`\n${content}\n\`\`\``;

    } else if (stats.isDirectory()) {
        const allFiles = await getAllFileUrisInDirectory(uri);
        if (allFiles.length === 0) {
            vscode.window.showInformationMessage('El directorio seleccionado está vacío.');
            return '';
        }
        const contentParts = await Promise.all(allFiles.map(async (fileUri) => {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
            try {
                const fileExtension = path.extname(fileUri.fsPath).toLowerCase();
                if (BINARY_EXTENSIONS.has(fileExtension)) {
                    return `${relativePath}\n\`\`\`\n[Contenido de archivo binario omitido]\n\`\`\``;
                }
                const content = await fs.promises.readFile(fileUri.fsPath, 'utf8');
                return `${relativePath}\n\`\`\`\n${content}\n\`\`\``;
            } catch (readError) {
                return `${relativePath}\n\`\`\`\n[ERROR AL LEER: ${readError instanceof Error ? readError.message : 'Error desconocido'}]\n\`\`\``;
            }
        }));
        return contentParts.join('\n\n---\n\n');
    }
    return '';
}

async function generateDirectoryTree(directoryPath: string, prefix: string = ''): Promise<string> {
    let treeString = '';
    try {
        const entries = (await fs.promises.readdir(directoryPath, { withFileTypes: true }))
            .filter(entry => !EXCLUDED_DIRS.has(entry.name));

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = prefix + (isLast ? '    ' : '│   ');

            treeString += `${prefix}${connector}${entry.name}\n`;

            if (entry.isDirectory()) {
                treeString += await generateDirectoryTree(path.join(directoryPath, entry.name), childPrefix);
            }
        }
    } catch (error) {
        console.error(`Error al generar el árbol para ${directoryPath}:`, error);
        treeString += `${prefix}[ERROR AL LEER DIRECTORIO]\n`;
    }
    return treeString;
}

export function activate(context: vscode.ExtensionContext) {

    const copyOrAnalyzeDisposable = vscode.commands.registerCommand('extension.copyOrAnalyzeContent', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No se ha seleccionado ningún archivo o directorio.');
            return;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('El elemento seleccionado no está dentro del espacio de trabajo.');
            return;
        }

        try {
            const filesContent = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Leyendo archivos...',
            }, async () => await getFileContent(uri, workspaceFolder));

            if (!filesContent) return;

            const userQuery = await vscode.window.showInputBox({
                prompt: 'Opcional: Introduce una pregunta para analizar el contenido con IA.',
                placeHolder: 'Ej: Resume este componente. (Deja vacío y pulsa Enter para copiar)',
                title: 'Copiar o Analizar Contenido'
            });

            if (userQuery && userQuery.trim() !== '') {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Analizando con IA...',
                    cancellable: false
                }, async () => {
                    const aiResult = await analyzeCode({ context: filesContent, query: userQuery });
                    await vscode.env.clipboard.writeText(aiResult);
                    vscode.window.showInformationMessage('¡Resultado del análisis copiado al portapapeles!');
                });
            } else {
                await vscode.env.clipboard.writeText(filesContent);
                vscode.window.showInformationMessage('Contenido de archivos copiado al portapapeles.');
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error al procesar: ${error instanceof Error ? error.message : 'Error desconocido'}`);
            console.error(error);
        }
    });

    const copyTreeDisposable = vscode.commands.registerCommand('extension.copyDirectoryTree', async (uri: vscode.Uri) => {
        if (!uri || !fs.statSync(uri.fsPath).isDirectory()) {
            vscode.window.showInformationMessage('Esta acción solo se puede usar en un directorio.');
            return;
        }

        try {
            const rootDirName = path.basename(uri.fsPath);
            const treeStructure = await generateDirectoryTree(uri.fsPath);
            const finalText = `${rootDirName}/\n${treeStructure}`;
            await vscode.env.clipboard.writeText(finalText);
            vscode.window.showInformationMessage('Árbol de directorio copiado al portapapeles.');
        } catch (error) {
            vscode.window.showErrorMessage(`Error al generar el árbol: ${error instanceof Error ? error.message : 'Error desconocido'}`);
            console.error(error);
        }
    });

    context.subscriptions.push(copyOrAnalyzeDisposable, copyTreeDisposable);
}

export function deactivate() {}