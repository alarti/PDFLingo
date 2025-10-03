# PDFLingo - PDF Translator

> Translate PDFs while preserving the original layout, fonts, and colors.

Created by **Alberto Arce**.

---

<img width="881" height="755" alt="image" src="https://github.com/user-attachments/assets/f4100970-b3a0-498b-bea1-ffa9193ad3f9" />


## ✨ Features

-   **High-Fidelity Translation**: Preserves the original document's layout, text colors, and font styles (bold, italic, etc.).
-   **Side-by-Side View**: A synchronized, dual-pane view to compare the original and translated documents in real-time.
-   **Multiple Service Options**: Choose between the powerful Google Gemini API or a self-hosted Ollama instance for translations.
-   **Enhanced Security**: Includes a one-click option to redact and anonymize sensitive information (PII) like emails, phone numbers, and credit card numbers before translation.
-   **Performance Optimized**: Efficiently handles large PDF files using a virtualized renderer that lazy-loads pages as you scroll.
-   **Intuitive UI**: A clean, modern interface featuring a custom language selector with flag icons.
-   **Dynamic Font Sizing**: Automatically adjusts font size to ensure translated text fits within the original's boundaries, preventing layout breaks.
-   **Downloadable Output**: Easily download the fully translated PDF.

## 🛠️ Technology Stack

-   **Frontend**: React, TypeScript, Tailwind CSS
-   **PDF Rendering & Parsing**: [PDF.js](https://mozilla.github.io/pdf.js/)
-   **PDF Creation & Manipulation**: [pdf-lib](https://pdf-lib.js.org/)
-   **Translation Services**:
    -   [Google Gemini API](https://ai.google.dev/)
    -   [Ollama](https://ollama.com/)

## ⚙️ How It Works

PDFLingo employs a sophisticated process to ensure high-quality translations while maintaining visual fidelity:

1.  **Load & Parse**: The uploaded PDF is loaded into the browser using PDF.js. Each page is parsed to extract text content along with its properties: position (`x`, `y`), dimensions (`width`, `height`), font name, and color.
2.  **High-Fidelity Color Sampling**: To get the exact text color, the page is rendered to a hidden canvas at a high resolution. The area around each text block is sampled to determine the background color, and then the text block itself is sampled to find a color that is distinct from the background, ensuring accuracy.
3.  **Redact (Optional)**: If the anonymization feature is enabled, the extracted text is scanned for PII, which is replaced with placeholders (e.g., `[REDACTED_EMAIL]`).
4.  **Translate**: The processed text is sent in batches to the selected translation service (Gemini or Ollama) with a specialized prompt that preserves placeholders and batch separators.
5.  **Reconstruct PDF**: A new PDF document is created using `pdf-lib`.
6.  **Overwrite & Write**: For each text block on a page:
    -   A white rectangle is drawn over the original text to hide it.
    -   The translated text is placed at the original's exact coordinates.
    -   The detected color and a standard font substitute (e.g., Helvetica-Bold for a bold font) are applied.
    -   The text is measured. If the translated text is wider than the original, the font size is proportionally reduced until it fits, preserving the document's layout.
7.  **Render**: The final translated PDF is displayed in the side-by-side viewer.

## 🚀 Getting Started

### Prerequisites

-   A modern web browser.
-   (Optional) A locally running instance of [Ollama](https://ollama.com/) if you wish to use it for translation.

### Running Locally

This project is a client-side single-page application and can be run by serving the files with any simple web server.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/pdflingo.git
    cd pdflingo
    ```

2.  **Configure API Key (for Gemini):**
    This project is configured to use an API key from an environment variable (`process.env.API_KEY`). For local development, you will need a build tool (like Vite or Webpack) that can substitute these variables at build time. Create a `.env` file in the project root:
    ```
    # See .env.example
    API_KEY="YOUR_GEMINI_API_KEY"
    ```

3.  **Serve the application:**
    Use a simple local server to run `index.html`. A popular choice is `serve`:
    ```bash
    # Install serve globally if you haven't already
    npm install -g serve

    # Run the server from the project root
    serve .
    ```
    Open your browser and navigate to the URL provided by the server (e.g., `http://localhost:3000`).

## 🔧 Configuration

### Gemini API

To use the Gemini translation service, you must obtain an API key from [Google AI Studio](https://aistudio.google.com/app/apikey) and configure it as an environment variable. The application expects this key to be available as `process.env.API_KEY`.

### Ollama

To use Ollama, ensure you have an instance running and that it is accessible from your browser (CORS may need to be configured on the Ollama side depending on your setup). Provide the full API URL in the application's UI, which defaults to `http://localhost:11434/api/generate`.

---

*This project was created by Alberto Arce.*

