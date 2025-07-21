// src/genkit-flow.ts

import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import * as vscode from 'vscode';

// Esquema de entrada y salida para mayor claridad y reutilización.
const AnalyzeCodeSchema = z.object({
    context: z.string().describe('El contenido de los archivos a analizar.'),
    query: z.string().describe('La pregunta del usuario sobre el código.'),
});

// Usaremos una variable para "cachear" el flow una vez que se inicialice.
// Esto evita tener que leer la configuración y recrear el flow en cada llamada.
let analysisFlow: any = null;

/**
 * Inicializa la instancia de Genkit y define el flow si aún no se ha hecho.
 * Este es un patrón de "lazy loading" adaptado a la nueva sintaxis de Genkit.
 * @returns El flow de análisis de código o null si la API Key no está configurada.
 */
function initializeAndGetFlow() {
    // Si ya lo creamos antes, simplemente lo retornamos.
    if (analysisFlow) {
        return analysisFlow;
    }

    const apiKey = vscode.workspace.getConfiguration('copyRelativePathAndContent').get<string>('googleAiApiKey');

    // Si no hay API key, no podemos continuar.
    if (!apiKey) {
        return null;
    }

    // 1. Nueva forma de inicialización.
    // Se configura una instancia de `ai` que contiene los plugins y configuración.
    const ai = genkit({
        plugins: [
            googleAI({ apiKey }) // Le pasamos la API key directamente al plugin.
        ],
    });

    console.log('Instancia de Genkit AI configurada.');

    // 2. Definimos el flow usando el objeto `ai` recién creado.
    // La definición del flow en sí misma es muy similar.
    analysisFlow = ai.defineFlow(
        {
            name: 'analyzeCodeFlow',
            inputSchema: AnalyzeCodeSchema,
            outputSchema: z.string(),
        },
        async ({ context, query }) => {
            try {
                // 3. Usamos `ai.generate` en lugar de `instancia.generate`.
                const llmResponse = await ai.generate({
                    // Es buena práctica especificar el modelo aquí.
                    // Nota: 'gemini-2.5-flash' es muy nuevo o puede ser un error tipográfico.
                    // 'gemini-1.5-flash' es una opción más común y robusta actualmente.
                    model: googleAI.model('gemini-2.0-flash'), 
                    prompt: `
                        Eres un asistente experto en análisis de código.
                        A continuación se te proporciona el contenido de uno o varios archivos.
                        
                        ### CONTEXTO DEL CÓDIGO ###
                        ${context}
                        ###########################
                        
                        ### TAREA ###
                        Analiza el código y responde a la siguiente pregunta:
                        "${query}"
                        ################
    
                        Proporciona una respuesta clara, concisa y directa.
                    `,
                    config: { temperature: 0.2 },
                });
                return llmResponse.text;
            } catch (error) {
                console.error("Error en el flow de Genkit:", error);
                if (error instanceof Error) {
                    throw new Error(`Error al contactar el servicio de IA: ${error.message}`);
                }
                throw new Error("Ocurrió un error desconocido al procesar la solicitud.");
            }
        }
    );

    console.log('Flow "analyzeCodeFlow" definido y listo para usar.');
    return analysisFlow;
}


/**
 * Función exportada que ejecuta el análisis de código.
 * Se encarga de obtener el flow (inicializándolo si es necesario) y ejecutarlo.
 */
export async function analyzeCode(input: z.infer<typeof AnalyzeCodeSchema>): Promise<string> {
    // Obtenemos el flow. La primera vez lo creará, las siguientes lo reutilizará.
    const flow = initializeAndGetFlow();

    if (!flow) {
        vscode.window.showErrorMessage('La función de IA requiere una API Key de Google AI. Por favor, configúrala en los ajustes de la extensión.');
        return "Error: API Key no configurada.";
    }

    // Ejecutamos el flow con el input.
    return await flow(input);
}