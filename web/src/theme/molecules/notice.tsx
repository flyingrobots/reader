/* Molecule: a status line that matters, as a shadcn Alert. `error` is the destructive Alert (a failure or an unreadable
   status, never shown as empty); `info` is the default Alert for a note the reader should act on. */
import type {ComponentProps, ReactNode} from 'react';
import {CircleAlertIcon, InfoIcon} from 'lucide-react';
import {Alert, AlertAction, AlertDescription, AlertTitle} from '@/components/ui/alert';

export function Notice({tone='info',title,action,children,...props}:{tone?:'info'|'error';title?:ReactNode;action?:ReactNode;children?:ReactNode}&Omit<ComponentProps<typeof Alert>,'variant'|'title'>){
  const Icon=tone==='error'?CircleAlertIcon:InfoIcon;
  return <Alert variant={tone==='error'?'destructive':'default'} data-tone={tone} {...props}>
    <Icon aria-hidden/>
    {title?<AlertTitle>{title}</AlertTitle>:null}
    {children?<AlertDescription>{children}</AlertDescription>:null}
    {action?<AlertAction>{action}</AlertAction>:null}
  </Alert>;
}
