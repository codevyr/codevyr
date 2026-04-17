const ASKL_FILE_TYPE = { description: 'Askl Query', accept: { 'text/plain': ['.askl'] } };

export async function saveQueryToFile(query: string): Promise<void> {
  if ('showSaveFilePicker' in window) {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: 'query.askl',
      types: [ASKL_FILE_TYPE],
    });
    const writable = await handle.createWritable();
    await writable.write(query);
    await writable.close();
  } else {
    // Fallback: blob download
    const blob = new Blob([query], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query.askl';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export async function openQueryFromFile(): Promise<string | null> {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [ASKL_FILE_TYPE],
        multiple: false,
      });
      const file = await handle.getFile();
      return file.text();
    } catch (e: any) {
      if (e?.name === 'AbortError') return null; // user cancelled
      throw e;
    }
  } else {
    // Fallback: hidden input[type=file]
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.askl,.txt';
      input.style.display = 'none';
      document.body.appendChild(input);

      const cleanup = () => {
        document.body.removeChild(input);
        window.removeEventListener('focus', handleFocus);
      };

      // Handle user cancellation: when the file dialog closes without
      // selecting a file, the window regains focus but onchange never fires.
      const handleFocus = () => {
        setTimeout(() => {
          if (!input.files?.length) {
            cleanup();
            resolve(null);
          }
        }, 300);
      };
      window.addEventListener('focus', handleFocus);

      input.onchange = async () => {
        const file = input.files?.[0];
        cleanup();
        resolve(file ? await file.text() : null);
      };

      input.click();
    });
  }
}
