import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';

export function IndexingGuide(){
  return <Card id="indexing-guide">
    <CardHeader><CardTitle>How indexing works</CardTitle><CardDescription>Indexes are derived copies of your library. Rebuilding them preserves the source documents.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p>Most indexing is rule-based: extract text and metadata, split text into passages, and store searchable records. <strong>No chat LLM writes summaries or decides tags during indexing.</strong></p>
      <p><strong>Rebuild with embeddings</strong> also runs a trained language model that turns passages into numeric vectors for meaning-based search. <strong>Keywords only</strong> skips this model inference.</p>
      <p>Rule-based results are reproducible for fixed inputs and versions. Exact embedding values and database bytes are not guaranteed to be identical across runs.</p>
      <Collapsible><CollapsibleTrigger render={<Button variant="outline" size="sm"/>}>Details: determinism, models & privacy</CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-3">
          <Table><TableHeader><TableRow><TableHead>Operation</TableHead><TableHead>Model use</TableHead><TableHead>What it does</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>Check freshness</TableCell><TableCell>No model inference</TableCell><TableCell>Compare saved indexes with library files and metadata. A check can be expensive, but does not generate embeddings.</TableCell></TableRow>
              <TableRow><TableCell>Keywords only</TableCell><TableCell>No model inference</TableCell><TableCell>Extract text, build passages and update keyword search. Missing embeddings remain missing.</TableCell></TableRow>
              <TableRow><TableCell>With embeddings</TableCell><TableCell>Embedding inference</TableCell><TableCell>Update search and generate missing vectors. Matching passage text and model signatures reuse cached vectors.</TableCell></TableRow>
              <TableRow><TableCell>Browse, catalog & links</TableCell><TableCell>No model inference</TableCell><TableCell>Read metadata, verify sources, generate navigation, mirror records and resolve links using code.</TableCell></TableRow>
            </TableBody>
          </Table>
          <p><strong>What “deterministic” means here.</strong> File bytes, settings, parser/software versions and calendar inputs determine the rule-based content. Timestamps and database layout can still change. Embedding inference is numerical computation, not sampled prose generation, but floating-point results can vary with the model, hardware, runtime or provider. Reader does not promise bit-for-bit identical vectors across backends.</p>
          <p><strong>Where the model runs.</strong> The default is FastEmbed with BAAI/bge-small-en-v1.5 on this machine; first setup may download model files. A configured embedding provider can replace it. A permitted remote provider receives passage text, so do not assume every configuration is local. Check the provider in Models settings.</p>
          <p><strong>Separate from LLM jobs.</strong> Generative summaries, tag suggestions and other Models-page tasks have their own controls. A normal index rebuild does not launch them, file inbox documents or mark anything as read.</p>
        </CollapsibleContent>
      </Collapsible>
    </CardContent>
  </Card>;
}
