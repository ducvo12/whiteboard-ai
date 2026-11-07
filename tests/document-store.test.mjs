import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createTLStore, GeoShapeUtil, ArrowShapeUtil, toRichText } from 'tldraw';
import {DocumentRepository,BoardConflict} from '../src/lib/whiteboard/document-store.ts';
import {boardDocumentSchema,validateDocument} from '../src/lib/whiteboard/document-schema.ts';
import {fullDocument} from './fixtures/full-document.mjs';

function fixture() {
  const store=createTLStore({schema:boardDocumentSchema});
  store.put([{id:'page:test',typeName:'page',name:'Page',index:'a1',meta:{}}]);
  const base={typeName:'shape',parentId:'page:test',index:'a1',x:10,y:20,rotation:.4,isLocked:false,opacity:.43,meta:{}};
  const geo=GeoShapeUtil.prototype.getDefaultProps(),arrow=ArrowShapeUtil.prototype.getDefaultProps();
  store.put([
    {...base,id:'shape:group',type:'group',props:{}},
    {...base,id:'shape:rect',parentId:'shape:group',type:'geo',meta:{attachedLabel:{text:'Label',x:1.2,y:-.2,size:21,color:'#abcdef',background:'transparent'}},props:{...geo,fill:'lined-fill',dash:'dashed',font:'mono',richText:toRichText('Rich label')}},
    {...base,id:'shape:arrow',type:'arrow',props:arrow},
    {id:'binding:test',typeName:'binding',type:'arrow',fromId:'shape:arrow',toId:'shape:rect',meta:{},props:{terminal:'end',normalizedAnchor:{x:.5,y:.5},isExact:false,isPrecise:true,snap:'none'}},
  ]);
  return store.getStoreSnapshot();
}
function isolated(fn) {
  const dir=mkdtempSync(join(tmpdir(),'whiteboard-document-'));
  try {fn(join(dir,'board.json'));}finally{rmSync(dir,{recursive:true,force:true});}
}
const object={id:'rect',object:'rect',x:0,y:0,w:100,h:80,rotation:0,strokeColor:'#123456',fillColor:'transparent',strokeWidth:2};

test('complete document survives repository restart with groups, binding, rich text, styles and labels',()=>isolated(path=>{
  const repository=new DocumentRepository(path),document=fixture();
  repository.commit(0,0,document,[object]);
  const restarted=new DocumentRepository(path);
  assert.deepEqual(restarted.read().document,validateDocument(document));
  assert.deepEqual(restarted.view(),[object]);
  assert.equal(restarted.read().document.store['shape:rect'].props.fill,'lined-fill');
  assert.ok(restarted.read().document.store['binding:test']);
}));

test('stale saves and unacknowledged agent commands never replace the document',()=>isolated(path=>{
  const repository=new DocumentRepository(path),document=fixture();
  repository.commit(0,0,document,[object]);
  const saved=readFileSync(path,'utf8');
  assert.throws(()=>repository.commit(0,0,document,[]),BoardConflict);
  assert.equal(readFileSync(path,'utf8'),saved);
  repository.enqueue({kind:'put',object:{...object,x:90}});
  assert.throws(()=>repository.commit(1,0,document,[object]),BoardConflict);
  assert.equal(repository.view()[0].x,90);
  assert.equal(new DocumentRepository(path).view()[0].x,90);
  repository.commit(1,1,document,[{...object,x:90}]);
  assert.equal(repository.read().commands.length,0);
}));

test('legacy process objects migrate once into durable commands',()=>isolated(path=>{
  const repository=new DocumentRepository(path,[object]);
  assert.equal(repository.read().document,null);
  assert.deepEqual(repository.view(),[object]);
  assert.equal(new DocumentRepository(path,[object]).read().commands.length,1);
}));

test('corrupt and invalid data is rejected without overwriting the saved file',()=>isolated(path=>{
  const repository=new DocumentRepository(path),document=fixture();
  repository.commit(0,0,document,[object]);
  const saved=readFileSync(path,'utf8');
  const invalid=structuredClone(document);invalid.store['shape:rect'].props.fill='invalid';
  assert.throws(()=>repository.commit(1,0,invalid,[object]));
  assert.equal(readFileSync(path,'utf8'),saved);
  const cyclic=structuredClone(document);cyclic.store['shape:group'].parentId='shape:rect';
  assert.throws(()=>validateDocument(cyclic),/Cyclic/);
  writeFileSync(path,'corrupt');
  assert.throws(()=>new DocumentRepository(path));
  assert.equal(readFileSync(path,'utf8'),'corrupt');
}));

test('bindings must connect shapes and image asset references must exist', () => {
  const wrongTarget = structuredClone(fixture());
  wrongTarget.store['binding:test'].toId = 'page:test';
  assert.throws(() => validateDocument(wrongTarget));
  const missingAsset = fullDocument();
  delete missingAsset.store['asset:audit'];
  assert.throws(() => validateDocument(missingAsset), /asset/i);
});

test('saved command sequences must be ordered, unique, and nonnegative', () => isolated(path => {
  const repository = new DocumentRepository(path);
  repository.enqueue({ kind: 'put', object });
  const saved = repository.read();
  saved.commands.push(saved.commands[0]);
  writeFileSync(path, JSON.stringify(saved));
  assert.throws(() => new DocumentRepository(path), /sequence/i);
  saved.commands = [];
  saved.revision = -1;
  writeFileSync(path, JSON.stringify(saved));
  assert.throws(() => new DocumentRepository(path), /saved board/i);
}));
