/* Shared helpers for the browser suites. */
/** Chrome 156 and later report a CSP violation (script-src-attr) whenever any parser in the page meets an inline event
    handler, inert documents included, so DOMPurify parsing a document's untrusted `<img onerror>` logs one although it
    strips the handler and nothing runs (#151). True for that report only: the inline-handler message, raised from
    DOMPurify itself. Every other console error, CSP reports from anywhere else included, still fails a suite. */
const sanitizerReport=message=>/^Executing inline event handler violates the following Content Security Policy directive/.test(message.text())
  &&/\/assets\/vendor\/purify\.min\.js$/.test(message.location()?.url||'');
module.exports={sanitizerReport};
