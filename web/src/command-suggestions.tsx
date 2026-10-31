import {Card, CardContent, CardFooter} from './components/ui/card';
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle} from './components/ui/item';
import {Kbd} from './components/ui/kbd';
export type CommandChoices={choices:{index:number;value:string;label?:string;description?:string}[];selected:number;total:number;message:string};
export function CommandSuggestions({model}:{model:CommandChoices}){
  return <Card size="sm" data-command-suggestions="">
    <CardContent className="max-h-[min(55vh,26rem)] overflow-auto">
      {model.message?<p role="status">{model.message}</p>:<ItemGroup role="presentation" className="gap-0">{model.choices.map(choice=><Item key={choice.index} size="xs" variant={model.selected===choice.index?'muted':'default'}
        render={<button type="button" tabIndex={-1}/>} role="option" aria-selected={model.selected===choice.index} id={'command-option-'+choice.index} data-command-choice={choice.index} className="cursor-pointer text-left">
        <ItemContent><ItemTitle><span className="command-choice">{choice.label||choice.value}</span></ItemTitle>{choice.description?<ItemDescription className="line-clamp-2">{choice.description}</ItemDescription>:null}</ItemContent>
      </Item>)}</ItemGroup>}
    </CardContent>
    <CardFooter className="flex-wrap gap-2"><span>{model.total} suggestions</span><span><Kbd>↑</Kbd><Kbd>↓</Kbd> select · <Kbd>Tab</Kbd> fill · <Kbd>Enter</Kbd> run · <Kbd>Esc</Kbd> cancel</span></CardFooter>
  </Card>;
}
