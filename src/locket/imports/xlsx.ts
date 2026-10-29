import { DOMParser } from '@xmldom/xmldom'
import { fail } from '../model'
import { unzip } from './zip'

/** Read the first worksheet using OOXML relationships, shared/inline strings and scalar cells. */
export async function xlsxRows(bytes: Uint8Array): Promise<Record<string, string>[]> {
  const parts = await unzip(bytes), decoder = new TextDecoder()
  const xml = (name: string) => {
    const data = parts.get(name)
    if (!data) fail('IMPORT_XLSX', `The workbook is missing ${name}.`)
    const source = decoder.decode(data)
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('IMPORT_XLSX', 'Workbook entity declarations are not supported.')
    return new DOMParser({ errorHandler: { warning: () => {}, error: () => fail('IMPORT_XLSX', 'The workbook XML is not readable.'), fatalError: () => fail('IMPORT_XLSX', 'The workbook XML is not readable.') } }).parseFromString(source, 'application/xml')
  }
  const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name))
  const strings = parts.has('xl/sharedStrings.xml') ? elements(xml('xl/sharedStrings.xml'), 'si').map(n => elements(n, 't').map(t => t.textContent ?? '').join('')) : []
  const workbook = xml('xl/workbook.xml'), sheet = elements(workbook, 'sheet')[0]
  const date1904 = ['1','true'].includes(elements(workbook,'workbookPr')[0]?.getAttribute('date1904')??'')
  const dateStyles = new Set<number>()
  if(parts.has('xl/styles.xml')){
    const styles=xml('xl/styles.xml'),formats=new Map(elements(styles,'numFmt').map(f=>[Number(f.getAttribute('numFmtId')),f.getAttribute('formatCode')??'']))
    const xfs=elements(styles,'cellXfs')[0]
    if(xfs)elements(xfs,'xf').forEach((xf,index)=>{
      const id=Number(xf.getAttribute('numFmtId')),format=(formats.get(id)??'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,'')
      if((id>=14&&id<=22)||/[yd]/i.test(format))dateStyles.add(index)
    })
  }
  const relationship = sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rel = elements(xml('xl/_rels/workbook.xml.rels'), 'Relationship').find(r => r.getAttribute('Id') === relationship)
  const target = rel?.getAttribute('Target') ?? ''
  if (rel?.getAttribute('TargetMode') === 'External' || !/^(?:\/xl\/)?(?:worksheets\/)[\w.-]+\.xml$/.test(target)) fail('IMPORT_XLSX', 'Select a workbook with a local first worksheet.')
  const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target
  const rows = elements(xml(path), 'row').map(row => {
    const out: string[] = []
    for (const cell of elements(row, 'c')) {
      if (elements(cell, 'f').length) fail('IMPORT_XLSX', 'Export values instead of formulas before importing this workbook.')
      const ref = cell.getAttribute('r')?.match(/^([A-Z]+)[1-9]\d*$/)
      if (!ref) fail('IMPORT_XLSX', 'A workbook cell has no plain address.')
      let index = 0
      for (const c of ref[1]) index = index * 26 + c.charCodeAt(0) - 64
      if (index > 200) fail('IMPORT_XLSX', 'Split workbooks wider than 200 columns.')
      const raw = elements(cell, 'v')[0]?.textContent ?? '', type = cell.getAttribute('t')
      let value=type === 's' ? strings[Number(raw)] ?? '' : type === 'inlineStr' ? elements(cell, 't').map(t => t.textContent ?? '').join('') : raw
      if((type==='n'||!type)&&dateStyles.has(Number(cell.getAttribute('s')))&&/^\d+(?:\.\d+)?$/.test(raw)){
        const serial=Number(raw),epoch=date1904?Date.UTC(1904,0,1):serial<60?Date.UTC(1899,11,31):Date.UTC(1899,11,30)
        if(!date1904&&Math.floor(serial)===60)fail('IMPORT_XLSX','The workbook contains Excel’s nonexistent 1900 leap day.')
        const at=epoch+Math.floor(serial)*86400000
        if(!Number.isFinite(at)||serial>2958465)fail('IMPORT_XLSX','A workbook date is outside the supported range.')
        value=new Date(at).toISOString().slice(0,10)
      }
      out[index - 1] = value
    }
    return out
  }).filter(r => r.some(Boolean))
  const header = rows.shift() ?? []
  if (!header.length || header.some(h => !h) || new Set(header).size !== header.length) fail('IMPORT_XLSX', 'The workbook needs distinct column headers.')
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
