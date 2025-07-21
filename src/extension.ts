import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// REFACTOR: Conjunto de directorios a ignorar, para reutilizarlo en ambas funciones.
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', 'out']);

// Conjunto de extensiones de archivo que consideramos binarias.
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
 * Recorre un directorio de forma recursiva para la función 'Copiar Contenido'.
 * (Modificado para usar el conjunto EXCLUDED_DIRS)
 */
async function getAllFileUrisInDirectory(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
    let fileUris: vscode.Uri[] = [];
    try {
        const entries = await fs.promises.readdir(directoryUri.fsPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(directoryUri.fsPath, entry.name);
            const entryUri = vscode.Uri.file(fullPath);
            if (entry.isDirectory()) {
                if (EXCLUDED_DIRS.has(entry.name)) { // REFACTOR: Usa el conjunto compartido
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


// --- NUEVA FUNCIÓN ---
/**
 * Genera una representación de árbol de un directorio de forma recursiva.
 * @param directoryPath La ruta al directorio.
 * @param prefix El prefijo para la indentación y las líneas del árbol.
 * @returns Una cadena con la estructura del árbol.
 */
async function generateDirectoryTree(directoryPath: string, prefix: string = ''): Promise<string> {
    let treeString = '';
    try {
        // Lee y filtra los directorios excluidos
        const entries = (await fs.promises.readdir(directoryPath, { withFileTypes: true }))
            .filter(entry => !EXCLUDED_DIRS.has(entry.name));

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = prefix + (isLast ? '    ' : '│   ');

            treeString += `${prefix}${connector}${entry.name}\n`;

            if (entry.isDirectory()) {
                const subTree = await generateDirectoryTree(path.join(directoryPath, entry.name), childPrefix);
                treeString += subTree;
            }
        }
    } catch (error) {
        console.error(`Error al generar el árbol para ${directoryPath}:`, error);
        // Devuelve el error como parte del árbol para que el usuario sepa que algo falló
        treeString += `${prefix}[ERROR AL LEER DIRECTORIO]\n`;
    }

    return treeString;
}


export function activate(context: vscode.ExtensionContext) {

    // Comando original: Copiar Ruta y Contenido
    const copyPathContentDisposable = vscode.commands.registerCommand('extension.copyPathAndContent', async (uri: vscode.Uri) => {
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
                const fileExtension = path.extname(uri.fsPath).toLowerCase();
                if (BINARY_EXTENSIONS.has(fileExtension)) {
                    finalText = `${relativePath}\n\`\`\`\n[Contenido de archivo binario omitido]\n\`\`\``;
                } else {
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

    // --- NUEVO COMANDO: Copiar Árbol de Directorio ---
    const copyTreeDisposable = vscode.commands.registerCommand('extension.copyDirectoryTree', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No se ha seleccionado ningún directorio.');
            return;
        }

        try {
            const stats = fs.statSync(uri.fsPath);
            if (!stats.isDirectory()) {
                vscode.window.showInformationMessage('Esta acción solo se puede usar en un directorio.');
                return;
            }

            // Genera la estructura del árbol a partir de la ruta seleccionada.
            const treeStructure = await generateDirectoryTree(uri.fsPath);

            // Obtiene el nombre del directorio raíz y lo añade al principio.
            const rootDirName = path.basename(uri.fsPath);
            const finalText = `${rootDirName}/\n${treeStructure}`;

            // Copia al portapapeles y muestra notificación.
            await vscode.env.clipboard.writeText(finalText);
            vscode.window.showInformationMessage('Árbol de directorio copiado al portapapeles.');

        } catch (error) {
            vscode.window.showErrorMessage(`Error al generar el árbol del directorio: ${error instanceof Error ? error.message : String(error)}`);
            console.error(error);
        }
    });


    // Añade ambos comandos a las suscripciones para que se activen y desactiven correctamente.
    context.subscriptions.push(copyPathContentDisposable, copyTreeDisposable);
}

export function deactivate() {}