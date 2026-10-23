// A real Word task-pane manifest. The pane uses current Locket sign-in and
// stored-version review, never Word document identity as approval authority.
import type { Bindings } from '../auth.server'
export function approvalChannelWordManifest(env:Bindings){
 const origin=new URL(env.AUTH_ORIGIN).origin
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
 const xml=`<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
<Id>c94c7c44-d923-4edc-a912-4306f9326ef6</Id><Version>1.0.0.0</Version><ProviderName>Locket</ProviderName><DefaultLocale>en-US</DefaultLocale>
<DisplayName DefaultValue="Locket Approvals"/><Description DefaultValue="Review the exact stored agreement version and decide under your current Locket identity."/>
<SupportUrl DefaultValue="${escape(origin)}/app"/><AppDomains><AppDomain>${escape(origin)}</AppDomain></AppDomains>
<Hosts><Host Name="Document"/></Hosts><DefaultSettings><SourceLocation DefaultValue="${escape(origin)}/app#approval-word"/></DefaultSettings><Permissions>Restricted</Permissions>
</OfficeApp>`
 return new Response(xml,{headers:{'content-type':'application/xml; charset=utf-8','content-disposition':'attachment; filename="locket-approvals.xml"','cache-control':'no-store','x-content-type-options':'nosniff'}})
}
