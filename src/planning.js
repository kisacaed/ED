export function todayISO(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(new Date());}
export function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function weekStart(date){const d=new Date(date+'T00:00:00Z');return addDays(date,-((d.getUTCDay()+6)%7));}
export function formatDate(date){return new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));}
export function followupTasks(tasks,filter,today){
 const open=t=>['todo','revision'].includes(t.status);
 return tasks.filter(t=>filter==='overdue'?t.date<today&&open(t):filter==='submitted'?t.status==='submitted':filter==='revision'?t.status==='revision':t.date===today).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
export function copyWeek(tasks,student,start){return tasks.filter(t=>t.student===student&&t.date>=addDays(start,-7)&&t.date<start).map(t=>({date:addDays(t.date,7),subject:t.subject,title:t.title,detail:t.detail,questions:t.questions,...(t.book_id?{sources:{[student]:{bookId:t.book_id,pageStart:t.page_start,pageEnd:t.page_end}}}:{})}));}
