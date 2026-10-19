// Count overlapping approved page ranges once; approval never finishes a book automatically.
export function approvedPages(tasks,bookId){
 const ranges=tasks.filter(t=>t.book_id===bookId&&t.status==='approved'&&Number.isInteger(t.page_start)&&Number.isInteger(t.page_end)).map(t=>[t.page_start,t.page_end]).sort((a,b)=>a[0]-b[0]);
 let total=0,start=null,end=null;
 for(const [a,b] of ranges){if(start===null){start=a;end=b;}else if(a<=end+1){end=Math.max(end,b);}else{total+=end-start+1;start=a;end=b;}}
 return start===null?0:total+end-start+1;
}
