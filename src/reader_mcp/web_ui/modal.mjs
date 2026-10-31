/** Whether a modal is open: a native <dialog> or one of Reader's shadcn app dialogs (data-reader-modal, from
 * web/src/shell-dialog.tsx). Selection capture, reading keys and the scratch status line hold while one is. */
export const modalOpen=()=>!!document.querySelector('dialog[open],[data-reader-modal][data-open]');
