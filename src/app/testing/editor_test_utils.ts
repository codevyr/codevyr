import monaco from 'monaco-editor';

type CleanupFn = () => void;

export function setupEditorTestApis(
  editorInstance: monaco.editor.IStandaloneCodeEditor,
): CleanupFn | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return null;
  }

  const setQueryForTests = (value: string) => {
    editorInstance.setValue(value);
  };

  const getQueryForTests = () => editorInstance.getValue();

  (window as any).__asklSetQuery = setQueryForTests;
  (window as any).__asklGetQuery = getQueryForTests;

  return () => {
    if ((window as any).__asklSetQuery === setQueryForTests) {
      delete (window as any).__asklSetQuery;
    }
    if ((window as any).__asklGetQuery === getQueryForTests) {
      delete (window as any).__asklGetQuery;
    }
  };
}
