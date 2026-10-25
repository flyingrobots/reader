import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inlineDollar, mathOptions, mathPlugin} from '../src/reader_mcp/web_ui/math.mjs';

const markdownit=createRequire(import.meta.url)('../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
const md=markdownit({html:true,linkify:true});md.use(mathPlugin);
const inline=(source,env={})=>md.parseInline(source,env)[0].children.filter(t=>t.type==='math_inline').map(t=>t.content);

test('currency is never math',()=>{
  assert.deepEqual(inline('$20 and $30'),[]);
  assert.deepEqual(inline('It costs $1,500 or US$5, not $ 7 or 3$.'),[]);
  assert.deepEqual(inline('Between $a and b$ there is prose.'),[],'no TeX-ish content');
  assert.equal(inlineDollar('$5$',0),null);
  assert.deepEqual(inline('Rates: $lookup 41.20% vs 41.10%. Only-$lookup is slower.'),[],'a closing $ followed by a letter is not math');
  assert.deepEqual(inline('$group$ is sorted. Mark it-done, see ($and^*$ here).'),['and^*'],'a prose pair does not reopen at its closing $');
  assert.deepEqual(inline('not $k + 3$**. Dropped two spare buffer copies and **$k + 1$ passes'),['k + 3','k + 1']);
});
test('inline $…$ and \\(…\\) become math',()=>{
  assert.deepEqual(inline('Let $x^2$ grow.'),['x^2']);
  assert.deepEqual(inline('Greek $\\alpha$ and $a+b$.'),['\\alpha','a+b']);
  assert.deepEqual(inline('So $M = S → S × V$ and $x ≠ y$.'),['M = S → S × V','x ≠ y']);
  assert.deepEqual(inline('Always \\(y\\) here.'),['y']);
  const html=md.renderInline('Let $x^2$ grow.');
  assert.match(html,/<span class="reader-math reader-math-inline" data-tex="x\^2">\$x\^2\$<\/span>/);
});
test('escaped dollars stay literal',()=>{
  assert.deepEqual(inline('A \\$x^2$ escape.'),[]);
  assert.deepEqual(inline('Both $a\\$b=c$ inside.'),['a\\$b=c']);
  assert.match(md.renderInline('A \\$x^2$ escape.'),/A \$x\^2\$ escape\./);
});
test('math inside code stays literal',()=>{
  assert.deepEqual(inline('Code `$x^2$` here.'),[]);
  const tokens=md.parse('```\n$$\na=b\n$$\n```\n',{});
  assert.ok(!tokens.some(t=>t.type==='math_block'));
  assert.match(md.render('    $$\n    a=b\n    $$\n'),/<pre><code>\$\$/);
});
test('display math is one block with the correct line map',()=>{
  const tokens=md.parse('Intro.\n\n$$\n a=b \n$$\n\nAfter.\n',{});
  const block=tokens.find(t=>t.type==='math_block');
  assert.equal(block.content,'a=b');assert.deepEqual(block.map,[2,5]);
  assert.deepEqual(md.parse('$$ e=mc^2 $$\n',{}).find(t=>t.type==='math_block').map,[0,1]);
  assert.equal(md.parse('\\[\nx\n\\]\n',{}).find(t=>t.type==='math_block').content,'x');
  assert.ok(!md.parse('$$\nnever closed\n',{}).some(t=>t.type==='math_block'),'an unclosed $$ is text');
  assert.match(md.render('$$\na<b\n$$\n'),/<div class="reader-math reader-math-block" data-tex="a&lt;b">\$\$a&lt;b\$\$<\/div>/);
});
test('frontmatter math: false disables inline $ only',()=>{
  const env=mathOptions('---\ntitle: Prices\nmath: false\n---\n\nText');
  assert.equal(env.mathDollar,false);assert.equal(mathOptions('# No frontmatter').mathDollar,true);
  assert.deepEqual(inline('Let $x^2$ grow.',env),[]);
  assert.deepEqual(inline('Still \\(x^2\\).',env),['x^2']);
  assert.ok(md.parse('$$\na=b\n$$\n',env).some(t=>t.type==='math_block'));
});
