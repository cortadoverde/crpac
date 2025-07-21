import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// NUEVO: Definimos un Set con las extensiones de archivo que consideramos binarias.
// Usamos un Set para una búsqueda más rápida y eficiente.
const BINARY_EXTENSIONS = new Set([
    // Imágenes
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
    // Archivos comprimidos
    '.zip', '.rar', '.7z', '.tar', '.gz',
    // Documentos
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Ejecutables y librerías
    '.exe', '.dll', '.so', '.o',
    // Media
    '.mp3', '.mp4', '.mov', '.avi', '.wav', '.mkv',
    // Fuentes
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    // Sqllite y bases de datos
    '.sqlite', '.db', '.mdb',
]);

/**
 * Recorre un directorio de forma recursiva y devuelve una lista de URIs de todos los archivos encontrados.
 * (Esta función no cambia)
 */
async function getAllFileUrisInDirectory(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
    let fileUris: vscode.Uri[] = [];
    try {
        const entries = await fs.promises.readdir(directoryUri.fsPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(directoryUri.fsPath, entry.name);
            const entryUri = vscode.Uri.file(fullPath);
            if (entry.isDirectory()) {
                if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.vscode' || entry.name === 'out') {
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
        vscode.window.showWarningMessage(`No se pudo acceder a algunas partes del directorio: ${error instanceof Error ? error.message : String(error)}`);
    }
    return fileUris;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('extension.copyPathAndContent', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No se ha seleccionado ningún archivo o directorio.');
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('El elemento seleccionado no está dentro del espacio de trabajo.');
            return;
        }

        let finalText = '';

        try {
            const stats = fs.statSync(uri.fsPath);

            if (stats.isFile()) {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                
                // CAMBIO: Usamos la lista negra para decidir.
                const fileExtension = path.extname(uri.fsPath).toLowerCase();
                if (BINARY_EXTENSIONS.has(fileExtension)) {
                    finalText = `${relativePath}\n\`\`\`\n[Contenido de archivo binario omitido]\n\`\`\``;
                } else {
                    // Si no está en la lista negra, lo leemos como texto.
                    const content = fs.readFileSync(uri.fsPath, 'utf8');
                    finalText = `${relativePath}\n\`\`\`\n${content}\n\`\`\``;
                }

            } else if (stats.isDirectory()) {
                const allFiles = await getAllFileUrisInDirectory(uri);
                const combinedContent: string[] = [];

                if (allFiles.length === 0) {
                    vscode.window.showInformationMessage('El directorio seleccionado no contiene archivos.');
                    return;
                }

                for (const fileUri of allFiles) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
                    try {
                        // CAMBIO: Misma lógica de lista negra dentro del bucle.
                        const fileExtension = path.extname(fileUri.fsPath).toLowerCase();
                        if (BINARY_EXTENSIONS.has(fileExtension)) {
                            combinedContent.push(`${relativePath}\n\`\`\`\n[Contenido de archivo binario omitido]\n\`\`\``);
                        } else {
                            const content = fs.readFileSync(fileUri.fsPath, 'utf8');
                            combinedContent.push(`${relativePath}\n\`\`\`\n${content}\n\`\`\``);
                        }
                    } catch (readError) {
                        console.error(`Error al leer el archivo ${fileUri.fsPath}:`, readError);
                        combinedContent.push(`${relativePath} (ERROR: No se pudo leer el contenido)\n\`\`\`\n${readError instanceof Error ? readError.message : String(readError)}\n\`\`\``);
                    }
                }
                finalText = combinedContent.join('\n\n---\n\n');
            } else {
                vscode.window.showErrorMessage('El elemento seleccionado no es ni un archivo ni un directorio válido.');
                return;
            }

            await vscode.env.clipboard.writeText(finalText);
            vscode.window.showInformationMessage('Ruta(s) y contenido(s) copiados al portapapeles.');

        } catch (error) {
            vscode.window.showErrorMessage(`Error al procesar la selección: ${error instanceof Error ? error.message : String(error)}`);
            console.error(error);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}