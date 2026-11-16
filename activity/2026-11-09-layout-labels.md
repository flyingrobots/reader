# Clearer reading layout labels

Change kind: deliberate interface copy change.

The reading layout settings now offer **Scroll** and **Pages**. The footer
uses the same names, including its accessible button labels. The page-turn
setting refers to the Pages layout, which can show one page on a phone or
two facing pages on a wider screen. Stored preference values are unchanged.

The controls bundle was rebuilt with the existing monitored build runner.
TypeScript checking passed. The existing controls suite and mobile layout
suite verify selection and saved behavior against a synthetic vault; physical
phone testing remains outside this validation.
