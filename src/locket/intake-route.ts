// Commercial approval authority follows the frozen request route, never a live draft.
export const routeRoleSql = (agreement = 'a.id') => `COALESCE((SELECT f.approval_role FROM lk_request_forms f WHERE f.agreement_id=${agreement}),'approver')`
export const routedCommercialSql = `(SELECT CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END) IN ('owner',${routeRoleSql()})`
