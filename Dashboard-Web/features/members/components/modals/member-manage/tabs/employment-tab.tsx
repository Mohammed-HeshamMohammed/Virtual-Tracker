"use client"

import { Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { ManageableFieldOptionsSelect } from "@/features/members/components/organization-field-select"
import {
  MODAL_INPUT,
  MODAL_LABEL,
  STATIC_EMPLOYMENT_TYPES,
  STATIC_EMPLOYED_THROUGH,
  STATIC_WORKPLACE_MODELS,
  STATIC_TERMINATION_REASONS,
} from "@/features/members/config/members-config"
import type { TabProps } from "@/features/members/components/modals/member-manage/types"
import { Checkbox } from "@/shared/ui/checkbox";
import { SimpleDatePicker } from "@/shared/ui/simple-date-picker";

export function EmploymentTab({ state, setState }: TabProps) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">Job details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <ManageableFieldOptionsSelect
            fieldType="jobTitle"
            label="Job title"
            placeholder="Select the job title"
            value={state.empJobTitle}
            onChange={(v) => setState(s => ({ ...s, empJobTitle: v }))}
          />
          <ManageableFieldOptionsSelect
            fieldType="department"
            label="Department"
            placeholder="Select the department"
            value={state.empDepartment}
            onChange={(v) => setState(s => ({ ...s, empDepartment: v }))}
          />
          <ManageableFieldOptionsSelect
            fieldType="jobType"
            label="Job type"
            placeholder="Select the job type"
            value={state.empJobType}
            onChange={(v) => setState(s => ({ ...s, empJobType: v }))}
          />
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className={MODAL_LABEL}>Work address</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600" htmlFor="fallback-id">
                <Checkbox
                  checked={state.empMailing}
                  onChange={() => setState(s => ({ ...s, empMailing: !s.empMailing }))}
                />
                Mailing address
              </label>
            </div>
            <input
              type="text"
              value={state.empWorkAddress}
              onChange={(e) => setState(s => ({ ...s, empWorkAddress: e.target.value }))}
              placeholder="Search for an address"
              className={MODAL_INPUT} aria-label="Interactive control"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">Hiring details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <ManageableFieldOptionsSelect
            fieldType="employmentType"
            label="Employment type"
            placeholder="Select the employment type"
            value={state.empEmploymentType}
            onChange={(v) => setState(s => ({ ...s, empEmploymentType: v }))}
            staticOptions={STATIC_EMPLOYMENT_TYPES}
            compactMenu
          />
          <ManageableFieldOptionsSelect
            fieldType="employedThrough"
            label="Employed through"
            placeholder="Select the hiring arrangement"
            value={state.empEmployedThrough}
            onChange={(v) => setState(s => ({ ...s, empEmployedThrough: v }))}
            staticOptions={STATIC_EMPLOYED_THROUGH}
            compactMenu
          />
          <div className="sm:col-span-2">
            <ManageableFieldOptionsSelect
              fieldType="workplaceModel"
              label="In-office / Remote"
              placeholder="Select the workplace model"
              value={state.empWorkplace}
              onChange={(v) => setState(s => ({ ...s, empWorkplace: v }))}
              staticOptions={STATIC_WORKPLACE_MODELS}
              compactMenu
            />
          </div>
          <div>
            <label className={MODAL_LABEL}>% In-office</label>
            <div className="flex" aria-label="Interactive control">
              <input
                type="number"
                min={0}
                max={100}
                value={state.empOfficePct}
                onChange={(e) => setState(s => ({ ...s, empOfficePct: e.target.value }))}
                placeholder="0"
                className={cn(MODAL_INPUT, "rounded-r-none border-r-0")}
              />
              <span className="flex items-center rounded-r-lg border border-l-0 border-slate-200 bg-slate-100 px-2.5 text-xs font-medium text-slate-500">
                %
              </span>
            </div>
          </div>
          <div>
            <label className={MODAL_LABEL}>% Remote</label>
            <div className="flex">
              <input
                type="number"
                min={0}
                max={100}
                value={state.empRemotePct}
                onChange={(e) => setState(s => ({ ...s, empRemotePct: e.target.value }))}
                placeholder="0"
                className={cn(MODAL_INPUT, "rounded-r-none border-r-0")}
              />
              <span className="flex items-center rounded-r-lg border border-l-0 border-slate-200 bg-slate-100 px-2.5 text-xs font-medium text-slate-500">
                %
              </span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">Accounting</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={MODAL_LABEL}>Tax info</label>
            <input
              type="text"
              value={state.empTaxInfo}
              onChange={(e) => setState(s => ({ ...s, empTaxInfo: e.target.value }))}
              placeholder="No tax info"
              className={MODAL_INPUT}
            />
          </div>
          <div>
            <label className={MODAL_LABEL}>Account code</label>
            <input
              type="text"
              value={state.empAccountCode}
              onChange={(e) => setState(s => ({ ...s, empAccountCode: e.target.value }))}
              className={MODAL_INPUT}
            />
          </div>
          <ManageableFieldOptionsSelect
            fieldType="taxType"
            label="Tax type"
            placeholder="Select the tax type"
            value={state.empTaxType}
            onChange={(v) => setState(s => ({ ...s, empTaxType: v }))}
          />
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className={MODAL_LABEL}>Currency</label>
              <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden aria-label="Interactive control" />
            </div>
            <input
              type="text"
              disabled
              placeholder="Currency"
              className={cn(MODAL_INPUT, "cursor-not-allowed bg-slate-50 text-slate-400")}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">Timeline</h3>
        <div className="grid gap-4 sm:grid-cols-2" aria-label="Interactive control">
          <div>
            <label className={MODAL_LABEL}>Start date</label>
            <SimpleDatePicker
              value={state.empStartDate}
              onChange={(iso) => setState((s) => ({ ...s, empStartDate: iso }))}
              placeholder="Select start date"
              aria-label="Start date"
            />
          </div>
          <div>
            <ManageableFieldOptionsSelect
              fieldType="terminationReason"
              label="Termination reason"
              placeholder="Select the termination reason"
              value={state.empTermination}
              onChange={(v) => setState(s => ({ ...s, empTermination: v }))}
              staticOptions={STATIC_TERMINATION_REASONS}
              compactMenu aria-label="Interactive control"
            />
          </div>
          <div>
            <label className={MODAL_LABEL}>End date</label>
            <SimpleDatePicker
              value={state.empEndDate}
              onChange={(iso) => setState((s) => ({ ...s, empEndDate: iso }))}
              placeholder="Select end date"
              aria-label="End date"
            />
          </div>
          <div>
            <label className={MODAL_LABEL}>Employment comments</label>
            <textarea
              value={state.empComments}
              onChange={(e) => setState(s => ({ ...s, empComments: e.target.value }))}
              rows={2}
              className={cn(MODAL_INPUT, "min-h-16 resize-y")}
              placeholder="Notes"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
