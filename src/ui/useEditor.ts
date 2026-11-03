import { useSyncExternalStore } from "react";
import type { Editor, EditorState } from "../editor/editor";

/** Subscribe to the editor's (immutable) UI state. */
export function useEditorState(editor: Editor): EditorState {
  return useSyncExternalStore(editor.subscribe, editor.getState);
}
