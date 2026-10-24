import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {deploymentSpec} from './delivery/base/spec.mjs';
const root=process.cwd();
const config=JSON.parse(await readFile(new URL('../packaging.json',import.meta.url),'utf8'));
const spec=await deploymentSpec(root,config.artifact.specInputs);
const target=new URL('../management/integration/deployment-spec.json',import.meta.url);
const bytes=JSON.stringify(spec,null,2)+'\n';
if(process.argv.includes('--check')) {
 if(await readFile(target,'utf8')!==bytes)throw Error('Deployment specification is stale; run pnpm delivery:spec after the real build.');
 console.log('Deployment specification matches the real build and source policy.');
} else {
 await mkdir(new URL('../management/integration/',import.meta.url),{recursive:true});
 await writeFile(target,bytes);
 console.log(`Deployment specification written with ${spec.migrations.length} migrations.`);
}
