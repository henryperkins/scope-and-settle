// Defaults shared by the proposal editor and behavioral checks.
export function proposalDefaults(order, assessment, project) {
  const item = order?.lineItems[0] ?? assessment?.result.lineItems[0];
  const unpricedAssessment = !!assessment && !item;
  return {
    title: order?.title ?? assessment?.result.deliverables[0]?.slice(0,200) ?? 'Mobile checkout',
    deliverables: order?.deliverables ?? assessment?.result.deliverables ?? ['Mobile layouts for the existing checkout flow'],
    priceMode: item?.rateCardId ?? (item || unpricedAssessment ? 'custom' : project.rateCard[0].id),
    quantity: item?.quantity ?? 1,
    amount: unpricedAssessment ? '' : ((item?.unitAmountMinor ?? 25000)/100).toFixed(2),
    preservedItems: (order?.lineItems ?? assessment?.result.lineItems ?? []).slice(1),
  };
}

// A mixed request never inherits prices from unselected items.
export function selectedProposal(assessment, ids) {
  const items=(assessment?.result.items??[]).filter(i=>ids.includes(i.id));
  return {itemIds:items.map(i=>i.id),deliverables:items.map(i=>i.requestedDeliverable),lineItems:items.flatMap(i=>i.lineItems),totalMinor:items.reduce((sum,i)=>sum+i.proposedTotalMinor,0)};
}
