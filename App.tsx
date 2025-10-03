import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';

import { translateWithGemini, translateWithOllama } from './services/translationService';
import { redactText } from './services/redactionService';
import { TranslationService } from './types';
import { languageOptions } from './constants';
import { Spinner } from './components/Spinner';
import { UploadIcon, DownloadIcon, AlertTriangleIcon, RefreshCwIcon, ShieldIcon } from './components/icons';
import { PdfComparer } from './components/PdfComparer';
import { CustomSelect } from './components/CustomSelect';

// PDF.js worker setup. Provide the absolute URL from the CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://aistudiocdn.com/pdfjs-dist@5.4.149/build/pdf.worker.js';

type View = 'upload' | 'translating' | 'result';
type Status = { type: 'error' | 'warning'; message: string } | null;

// Helper to map font names from pdf.js to standard PDF fonts in pdf-lib, preserving styles.
const getFont = (fontName: string): StandardFonts => {
    const lower = fontName.toLowerCase();
    const isBold = lower.includes('bold');
    const isItalic = lower.includes('italic') || lower.includes('oblique');

    let baseFont: StandardFonts;

    if (lower.includes('times')) {
        baseFont = StandardFonts.TimesRoman;
    } else if (lower.includes('courier')) {
        baseFont = StandardFonts.Courier;
    } else { // Default to Helvetica
        baseFont = StandardFonts.Helvetica;
    }

    if (isBold && isItalic) {
        if (baseFont === StandardFonts.TimesRoman) return StandardFonts.TimesRomanBoldItalic;
        if (baseFont === StandardFonts.Courier) return StandardFonts.CourierBoldOblique;
        return StandardFonts.HelveticaBoldOblique;
    }
    if (isBold) {
        if (baseFont === StandardFonts.TimesRoman) return StandardFonts.TimesRomanBold;
        if (baseFont === StandardFonts.Courier) return StandardFonts.CourierBold;
        return StandardFonts.HelveticaBold;
    }
    if (isItalic) {
        if (baseFont === StandardFonts.TimesRoman) return StandardFonts.TimesRomanItalic;
        if (baseFont === StandardFonts.Courier) return StandardFonts.CourierOblique;
        return StandardFonts.HelveticaOblique;
    }
    
    return baseFont;
};


// All work by Alberto Arce
export default function App() {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [translatedPdfBytes, setTranslatedPdfBytes] = useState<Uint8Array | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<string>('Spanish');
    const [translationService, setTranslationService] = useState<TranslationService>(TranslationService.Gemini);
    const [ollamaUrl, setOllamaUrl] = useState<string>('http://localhost:11434/api/generate');
    const [status, setStatus] = useState<Status>(null);
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [view, setView] = useState<View>('upload');
    const [anonymize, setAnonymize] = useState(true);

    // Manage download URL lifecycle based on the translated PDF data
    useEffect(() => {
        if (translatedPdfBytes) {
            const blob = new Blob([translatedPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);

            // Return a cleanup function to revoke the URL when the component unmounts or the data changes
            return () => {
                URL.revokeObjectURL(url);
            };
        }
    }, [translatedPdfBytes]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
            setStatus(null);
        } else {
            setPdfFile(null);
            setStatus({ type: 'error', message: 'Please select a valid PDF file.' });
        }
    };

    const isTranslateDisabled = useMemo(() => {
        if (!pdfFile) return true;
        if (translationService === TranslationService.Ollama && !ollamaUrl) return true;
        return false;
    }, [pdfFile, translationService, ollamaUrl]);

    const copyMetadata = (source: PDFDocument, destination: PDFDocument) => {
        destination.setTitle(source.getTitle() || '');
        destination.setAuthor(source.getAuthor() || 'Alberto Arce');
        destination.setSubject(source.getSubject() || '');
        destination.setKeywords(source.getKeywords()?.split(';') || []);
        destination.setProducer(source.getProducer() || 'PDFLingo by Alberto Arce');
        destination.setCreator('PDFLingo by Alberto Arce');
        destination.setCreationDate(source.getCreationDate() || new Date());
        destination.setModificationDate(new Date());
    };

    const handleTranslate = useCallback(async () => {
        if (!pdfFile) return;

        setView('translating');
        setStatus(null);
        setTranslatedPdfBytes(null);
        setProgressMessage('Starting translation process...');

        try {
            const arrayBuffer = await pdfFile.arrayBuffer();
            setProgressMessage('Loading PDF document...');
            
            const pdfDocPromise = PDFDocument.load(arrayBuffer);
            const pdfjsDocPromise = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

            const [pdfDoc, pdfjsDoc] = await Promise.all([pdfDocPromise, pdfjsDocPromise]);
            const newPdfDoc = await PDFDocument.create();
            copyMetadata(pdfDoc, newPdfDoc);

            const embeddedFonts: Map<StandardFonts, PDFFont> = new Map();
            const totalPages = pdfjsDoc.numPages;

            for (let i = 0; i < totalPages; i++) {
                const pageNum = i + 1;
                setProgressMessage(`Processing page ${pageNum} of ${totalPages}...`);
                
                const [originalPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
                newPdfDoc.addPage(originalPage);
                const newPage = newPdfDoc.getPage(i);

                const pdfjsPage = await pdfjsDoc.getPage(pageNum);
                const textContent = await pdfjsPage.getTextContent();
                
                if (textContent.items.length === 0) continue;

                // Render page to canvas to sample text colors
                const viewport = pdfjsPage.getViewport({ scale: 3.0 }); // Higher scale for better color accuracy
                const canvas = document.createElement('canvas');
                const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
                if (!canvasContext) continue;

                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                await pdfjsPage.render({ canvas, canvasContext, viewport } as any).promise;

                const itemsWithStyle = textContent.items.map(item => {
                    if (!('str' in item) || item.str.trim().length === 0) {
                        return item;
                    }

                    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    const canvasX = tx[4];
                    const canvasY = tx[5];
                    const canvasWidth = item.width * viewport.scale;
                    const canvasHeight = item.height * viewport.scale;

                    // 1. Sample background color (just outside the bounding box)
                    const bgSampleX = Math.max(0, Math.floor(canvasX - 5));
                    const bgSampleY = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvasY - canvasHeight * 0.5)));
                    const [bgR, bgG, bgB] = canvasContext.getImageData(bgSampleX, bgSampleY, 1, 1).data;

                    const samplePoints = [
                        { x: canvasX + canvasWidth * 0.5, y: canvasY - canvasHeight * 0.5 }, // Center
                        { x: canvasX + canvasWidth * 0.25, y: canvasY - canvasHeight * 0.25 }, // Top-left-ish
                        { x: canvasX + canvasWidth * 0.75, y: canvasY - canvasHeight * 0.75 }, // Bottom-right-ish
                    ];

                    let finalColor = rgb(0, 0, 0); // Default to black
                    let colorFound = false;

                    for (const point of samplePoints) {
                        const sx = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x)));
                        const sy = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y)));
                        const [r, g, b] = canvasContext.getImageData(sx, sy, 1, 1).data;
                        
                        const diff = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));

                        if (diff > 50) { // If color is significantly different from background
                            finalColor = rgb(r / 255, g / 255, b / 255);
                            colorFound = true;
                            break;
                        }
                    }

                    // Fallback for white text on a dark background.
                    if (!colorFound && (bgR + bgG + bgB) / 3 < 128) {
                         finalColor = rgb(1, 1, 1);
                    }
                    
                    return { ...item, color: finalColor };
                });

                const originalTexts = itemsWithStyle.map(item => ('str' in item ? item.str : '')).filter(str => str.trim().length > 0);
                if(originalTexts.length === 0) continue;

                let textsToProcess = originalTexts;
                if (anonymize) {
                    setProgressMessage(`Anonymizing data for page ${pageNum}...`);
                    textsToProcess = originalTexts.map(text => redactText(text));
                }

                const textToTranslate = textsToProcess.join(' ||| ');
                
                setProgressMessage(`Translating text for page ${pageNum}...`);
                let translatedFullText;
                if (translationService === TranslationService.Gemini) {
                    translatedFullText = await translateWithGemini(textToTranslate, targetLanguage);
                } else {
                    translatedFullText = await translateWithOllama(textToTranslate, targetLanguage, ollamaUrl);
                }
                const translatedTexts = translatedFullText.split(' ||| ');
                
                let currentTranslatedIndex = 0;

                for (const item of itemsWithStyle) {
                    if ('str' in item && item.str.trim().length > 0 && 'color' in item) {
                        const { transform, width, height, fontName, color } = item as any;
                        
                        const [x, y] = [transform[4], transform[5]];
                        newPage.drawRectangle({
                            x,
                            y: y - (height * 0.25),
                            width: width + 1,
                            height: height * 1.25,
                            color: rgb(1, 1, 1),
                        });
                        
                        if (currentTranslatedIndex < translatedTexts.length) {
                            const translatedText = translatedTexts[currentTranslatedIndex];
                            const fontType = getFont(fontName);

                            if (!embeddedFonts.has(fontType)) {
                                embeddedFonts.set(fontType, await newPdfDoc.embedFont(fontType));
                            }
                            const font = embeddedFonts.get(fontType)!;

                            const originalSize = height;
                            const originalWidth = width;
                            
                            let newSize = originalSize;
                            const textWidth = font.widthOfTextAtSize(translatedText, originalSize);

                            // If translated text is wider than the original, scale down the font size.
                            if (textWidth > originalWidth && originalWidth > 0) {
                                newSize = originalSize * (originalWidth / textWidth) * 0.95; // 0.95 for padding
                            }
                            
                            // Prevent text from becoming too small to read.
                            newSize = Math.max(newSize, 4); 

                            newPage.drawText(translatedText, {
                                x,
                                y,
                                font,
                                size: newSize,
                                color: color,
                            });
                            currentTranslatedIndex++;
                        }
                    }
                }
            }

            setProgressMessage('Finalizing translated PDF...');
            const pdfBytes = await newPdfDoc.save();
            setTranslatedPdfBytes(pdfBytes);
            setView('result');

        } catch (e) {
            console.error(e);
            setStatus({type: 'error', message: `An error occurred: ${e instanceof Error ? e.message : String(e)}`});
            setView('upload');
        } finally {
            setProgressMessage('');
        }
    }, [pdfFile, targetLanguage, translationService, ollamaUrl, anonymize]);

    const handleReset = () => {
        setPdfFile(null);
        setTranslatedPdfBytes(null);
        setDownloadUrl(null);
        setStatus(null);
        setProgressMessage('');
        setView('upload');
    };

    const renderContent = () => {
        switch(view) {
            case 'translating':
                return (
                    <div className="flex flex-col items-center justify-center text-center">
                        <Spinner />
                        <p className="text-xl font-semibold mt-4">{progressMessage || 'Translating...'}</p>
                        <p className="text-gray-500 dark:text-gray-400">Please wait, this may take a few moments.</p>
                    </div>
                );
            case 'result':
                return (
                    <div className="w-full max-w-7xl mx-auto">
                        <header className="text-center mb-6">
                            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-500">Translation Complete</h2>
                        </header>
                         {pdfFile && translatedPdfBytes && (
                            <PdfComparer originalFile={pdfFile} translatedBytes={translatedPdfBytes} />
                        )}
                        <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center">
                            {downloadUrl && (
                                <a
                                    href={downloadUrl}
                                    download={pdfFile?.name.replace('.pdf', `_${targetLanguage}.pdf`)}
                                    className="w-full sm:w-auto flex justify-center items-center gap-2 bg-green-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 text-center"
                                >
                                    <DownloadIcon className="h-5 w-5"/>
                                    Download Translated PDF
                                </a>
                            )}
                             <button
                                onClick={handleReset}
                                className="w-full sm:w-auto flex justify-center items-center gap-2 bg-gray-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-700 transition-transform transform hover:scale-105"
                            >
                                <RefreshCwIcon className="h-5 w-5"/>
                                Translate Another File
                            </button>
                        </div>
                    </div>
                );
            case 'upload':
            default:
                return (
                    <div className="w-full max-w-2xl mx-auto">
                        <header className="text-center mb-8">
                            <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-400">PDFLingo</h1>
                            <p className="text-gray-600 dark:text-gray-400 mt-2">Translate PDFs while preserving layout. By Alberto Arce.</p>
                        </header>

                        <main className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 space-y-6">
                            <div className="space-y-2">
                                <label htmlFor="pdf-upload" className="font-medium">1. Upload PDF File</label>
                                <div className="flex items-center justify-center w-full">
                                    <label htmlFor="pdf-upload" className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 dark:border-gray-600 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-bray-800 dark:bg-gray-700 hover:bg-gray-100 dark:hover:border-gray-500 dark:hover:bg-gray-600 transition-colors">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <UploadIcon className="w-8 h-8 mb-3 text-gray-500 dark:text-gray-400" />
                                            {pdfFile ? (
                                                <p className="font-semibold text-blue-600 dark:text-blue-400">{pdfFile.name}</p>
                                            ) : (
                                                <>
                                                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">PDF only</p>
                                                </>
                                            )}
                                        </div>
                                        <input id="pdf-upload" type="file" className="hidden" accept=".pdf" onChange={handleFileChange} />
                                    </label>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label htmlFor="target-language" className="font-medium">2. Target Language</label>
                                    <CustomSelect
                                        options={languageOptions}
                                        value={targetLanguage}
                                        onChange={setTargetLanguage}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="font-medium">3. Translation Service</label>
                                    <div className="flex space-x-4 items-center h-full">
                                        <div className="flex items-center">
                                            <input type="radio" id="gemini" name="service" value={TranslationService.Gemini} checked={translationService === TranslationService.Gemini} onChange={() => setTranslationService(TranslationService.Gemini)} className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                                            <label htmlFor="gemini" className="ml-2">Gemini</label>
                                        </div>
                                        <div className="flex items-center">
                                            <input type="radio" id="ollama" name="service" value={TranslationService.Ollama} checked={translationService === TranslationService.Ollama} onChange={() => setTranslationService(TranslationService.Ollama)} className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                                            <label htmlFor="ollama" className="ml-2">Ollama</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {translationService === TranslationService.Ollama && (
                                <div className="space-y-2">
                                    <label htmlFor="ollama-url" className="font-medium">Ollama API URL</label>
                                    <input
                                        type="text"
                                        id="ollama-url"
                                        value={ollamaUrl}
                                        onChange={(e) => setOllamaUrl(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g., http://localhost:11434/api/generate"
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="font-medium">4. Security</label>
                                <div className="flex items-center p-3 rounded-md bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                                    <input
                                        type="checkbox"
                                        id="anonymize"
                                        checked={anonymize}
                                        onChange={(e) => setAnonymize(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <label htmlFor="anonymize" className="ml-3 text-sm flex items-center">
                                        <ShieldIcon className="h-5 w-5 mr-2 text-green-600 dark:text-green-400" />
                                        Anonymize sensitive data (Recommended)
                                    </label>
                                </div>
                            </div>
                            
                            <button
                                onClick={handleTranslate}
                                disabled={isTranslateDisabled}
                                className="w-full flex justify-center items-center gap-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-transform transform hover:scale-105"
                            >
                                Translate PDF
                            </button>

                            <div className="pt-4">
                                {status && (
                                    <div className={`border-l-4 p-4 rounded-md flex items-center gap-3 ${status.type === 'error' ? 'bg-red-100 dark:bg-red-900 border-red-500 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 border-yellow-500 text-yellow-700 dark:text-yellow-200'}`} role="alert">
                                        <AlertTriangleIcon className="h-6 w-6"/>
                                        <div>
                                            <p className="font-bold">{status.type === 'error' ? 'Error' : 'Warning'}</p>
                                            <p>{status.message}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </main>
                    </div>
                );
        }
    }

    return (
        <div className="min-h-screen flex flex-col bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <main className="flex-grow flex items-center justify-center p-4">
                {renderContent()}
            </main>
            <footer className="text-center p-4 text-gray-500 dark:text-gray-400 text-sm">
                <p>Created by Alberto Arce.</p>
                <p>Powered by Gemini, Ollama, React, pdf-lib, PDF.js, and Tailwind CSS.</p>
            </footer>
        </div>
    );
}