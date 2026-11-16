/* The keyboard help's body: keys.mjs supplies the sections, and app.mjs mounts this in the help dialog. */
import {Kbd, KbdGroup} from './components/ui/kbd';
import {ItemDescription, ItemTitle} from './components/ui/item';
import {Table, TableBody, TableCell, TableRow} from './components/ui/table';

export type HelpRow={keys:string[][];help:string;command?:string};
export type HelpSection={name:string;note?:boolean;rows:HelpRow[]};
const Text=({text}:{text:string})=><>{text.split(/`([^`]+)`/).map((part,index)=>index%2?<Kbd key={index}>{part}</Kbd>:part)}</>;
function Row({row}:{row:HelpRow}){
  return <TableRow data-command={row.command}>
    <TableCell data-help-key="" className="w-36 align-top whitespace-normal">{row.keys.map((group,index)=><span key={index}>{index?' / ':''}<KbdGroup>{group.map((key,at)=><Kbd key={at}>{key}</Kbd>).flatMap((kbd,at)=>at?[' ',kbd]:[kbd])}</KbdGroup></span>)}</TableCell>
    <TableCell className="align-top whitespace-normal text-muted-foreground"><Text text={row.help}/></TableCell>
  </TableRow>;
}
export function HelpKeys({sections}:{sections:HelpSection[]}){
  return <>{sections.map(section=><section key={section.name} className="flex flex-col gap-2">
    <ItemTitle role="heading" aria-level={3} className="help-group">{section.name}</ItemTitle>
    {section.note?<ItemDescription className="line-clamp-none"><Text text="Press `:` to type a command in the status line. `Tab` completes, `↑` `↓` select suggestions, `Ctrl p` `Ctrl n` recall earlier commands, `Enter` runs, `Esc` cancels."/></ItemDescription>:null}
    <Table className={section.note?'keymap-table commands':'keymap-table'}><TableBody>{section.rows.map((row,index)=><Row key={index} row={row}/>)}</TableBody></Table>
  </section>)}</>;
}
