/* Organism: an action that asks first, as a shadcn AlertDialog instead of window.confirm(). The trigger is the visible
   button; the dialog names what happens and what does not, and its confirm button carries the action's own label. */
import type {ComponentProps, ReactNode} from 'react';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';

export function ConfirmAction({label,title,description,confirm,onConfirm,disabled,variant='ghost',size='xs'}:{label:ReactNode;title:ReactNode;description:ReactNode;confirm:string;onConfirm:()=>void;disabled?:boolean}&Pick<ComponentProps<typeof Button>,'variant'|'size'>){
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant={variant} size={size} disabled={disabled}/>}>{label}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" data-confirm="" onClick={onConfirm}>{confirm}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
