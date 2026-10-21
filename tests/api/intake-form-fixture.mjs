// Shared supplier scenario, entered through public commands by API and browser journeys.
export function supplierForm({ ownerId, reviewerId, audienceId, name = 'Supplier procurement', highRole = 'counsel' }) {
  const defaultRoute={ownerId,reviewerId:ownerId,approvalRole:'approver'}
  return {name,type:'supplier',fields:[
    {key:'security',label:'Security questionnaire needed',kind:'pick_list',required:true,options:['Standard review','Enhanced review'],when:[{field:'value',op:'gt',value:'50000'}]},
  ],requirements:['Pricing schedule'],launch:{roles:[],audienceIds:[audienceId]},defaultRoute,rules:[
    {name:'High value counsel',when:[{field:'value',op:'gt',value:'50000'}],route:{ownerId,reviewerId,approvalRole:highRole},requirements:['Security questionnaire']},
  ]}
}
