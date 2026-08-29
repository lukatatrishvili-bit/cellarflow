import React from 'react';
import type { useWineryState } from '../hooks/useWineryState';
import { canAccess } from '../server/permissions';
import { canViewUserDestination } from '../lib/navigationPermissions';
import type { CellarWorkflowPermissions } from '../lib/workflowPermissions';
import CellarWorkspace, { type CellarWorkspaceProps } from './CellarWorkspace';

type WineryStateFacade = ReturnType<typeof useWineryState>;

interface CellarWorkspaceRouteProps {
  state: WineryStateFacade;
  permissions: CellarWorkflowPermissions;
  onOpenProductionPlan: (planId: string) => void;
  onLogOperation: NonNullable<CellarWorkspaceProps['onLogOperation']>;
  onPlanTransfer: NonNullable<CellarWorkspaceProps['onPlanTransfer']>;
  renderQvevriRecords: NonNullable<CellarWorkspaceProps['renderQvevriRecords']>;
}

/** Keeps aggregate cellar wiring in the cellar's lazy route, off the app shell. */
export default function CellarWorkspaceRoute({
  state,
  permissions,
  onOpenProductionPlan,
  onLogOperation,
  onPlanTransfer,
  renderQvevriRecords,
}: CellarWorkspaceRouteProps) {
  const role = state.currentUser.role;
  const canView = (tab: string) => canViewUserDestination(state.currentUser, 'gvino', tab);
  return (
    <CellarWorkspace
      lang={state.lang}
      lots={state.lots}
      vessels={state.vessels}
      operations={state.cellarOps}
      cellarFloors={state.companyProfile.cellarFloors}
      productionPlans={canView('planner') ? state.productionPlans : []}
      tasks={canView('tasks') ? state.tasks : []}
      initialMode={state.activeTab === 'vessels' ? 'vessels' : 'lots'}
      initialVesselId={state.selectedTankId}
      onCanonicalize={() => { if (state.activeTab !== 'cellar') state.setActiveTab('cellar'); }}
      canViewLots={canView('lots')}
      canViewVessels={canView('vessels')}
      onUpdateLots={state.setLots}
      onUpdateVessels={state.setVessels}
      onUpdateCellarFloors={canAccess(role, 'vessels', 'update') ? (floors) => state.setCompanyProfile(current => ({ ...current, cellarFloors: floors })) : undefined}
      onOpenProductionPlan={canView('planner') ? onOpenProductionPlan : undefined}
      {...permissions.vessels}
      canExecuteTransfer={permissions.transfers.canExecuteTransfer}
      canCreateLot={canAccess(role, 'lots', 'create')}
      canUpdateLot={canAccess(role, 'lots', 'update')}
      onOpenPassport={state.setPassportLotId}
      fermLogs={state.fermLogs}
      labLogs={state.labLogs}
      costEntries={state.costEntries}
      bottlingRuns={state.bottlingRuns}
      stockMovements={state.stockMovements}
      salesOrders={state.salesOrders}
      salesDispatches={state.salesDispatches}
      currency={state.companyProfile.currency || 'GEL'}
      setActiveTab={state.setActiveTab}
      setSelectedTankId={state.setSelectedTankId}
      setCalculatorLotId={state.setCalculatorLotId}
      setCalculatorLotIdA={state.setCalculatorLotIdA}
      setChartLotId={state.setChartLotId}
      setLabLotId={state.setLabLotId}
      currentUserName={state.currentUser.fullName || state.currentUser.username}
      currentUsername={state.currentUser.username}
      auditLogs={state.auditLogs}
      onUpdateAuditLogs={state.setAuditLogs}
      onApplyLotStageTransitionCommandResponse={state.applyLotStageTransitionCommandResponse}
      setToastMessage={state.setToastMessage}
      onOpenVesselDetails={state.setSelectedTankId}
      onLogOperation={permissions.operations.canLogCellarOperation ? onLogOperation : undefined}
      onPlanTransfer={permissions.transfers.canExecuteTransfer ? onPlanTransfer : undefined}
      renderQvevriRecords={renderQvevriRecords}
    />
  );
}
