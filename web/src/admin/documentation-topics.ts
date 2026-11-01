import overview from '../../../docs/topics/overview.md';
import jobs from '../../../docs/topics/jobs.md';
import logs from '../../../docs/topics/logs.md';
import repositories from '../../../docs/topics/repositories.md';
import voices from '../../../docs/topics/voices.md';
import models from '../../../docs/topics/models.md';
import inbox from '../../../docs/topics/inbox.md';
import indexes from '../../../docs/topics/indexes.md';
import artwork from '../../../docs/topics/artwork.md';
import library from '../../../docs/topics/library.md';
import service from '../../../docs/topics/service.md';
import settings from '../../../docs/topics/settings.md';
export const ADMIN_DOCUMENTS:Record<string,{title:string;source:string;aliases?:Record<string,string>}>= {
  overview:{title:'Overview',source:overview}, jobs:{title:'Coding Jobs',source:jobs,aliases:{jobs:'job-list'}},
  logs:{title:'LLM logs',source:logs},repositories:{title:'Repositories',source:repositories},voices:{title:'Voices',source:voices},
  models:{title:'Models',source:models},inbox:{title:'Inbox',source:inbox},indexes:{title:'Indexes',source:indexes},
  artwork:{title:'Artwork',source:artwork},library:{title:'Library',source:library},service:{title:'Service & tools',source:service,aliases:{server:'reader-service'}},settings:{title:'Settings',source:settings}
};
