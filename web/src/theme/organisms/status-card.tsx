/* Organism: the Admin status card. Full shadcn Card composition: a titled header with its one-line purpose and a status
   badge in CardAction, the body, and the actions in CardFooter. Every Admin panel that reports on one thing (an index,
   the inbox, a service, a tile) is this card, so the same question is always answered in the same place. */
import type {ComponentProps, ReactNode} from 'react';
import {cn} from 'cn';
import {Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';

export function StatusCard({title,titleId,description,badge,footer,children,className,...props}:{title:ReactNode;titleId?:string;description?:ReactNode;badge?:ReactNode;footer?:ReactNode;children?:ReactNode}&Omit<ComponentProps<typeof Card>,'title'>){
  return <Card size="sm" className={cn('min-w-0',className)} {...props}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2} id={titleId}>{title}</CardTitle>
      {description?<CardDescription>{description}</CardDescription>:null}
      {badge?<CardAction>{badge}</CardAction>:null}
    </CardHeader>
    {children?<CardContent className="flex flex-1 flex-col gap-3">{children}</CardContent>:null}
    {footer?<CardFooter className="flex-wrap gap-2">{footer}</CardFooter>:null}
  </Card>;
}
