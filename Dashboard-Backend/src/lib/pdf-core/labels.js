// GENERATED from Dashboard-Web/shared/pdf-core - do not edit by hand.
// Change the TypeScript there and run `npm run sync:pdf-core` in Dashboard-Web.
                                               

/** Every word a generated PDF prints, in each language it can be made in. */
                            
                    
           
              
              
                
                 
                 
                  
                
              
               
                 
                
              
                
               
                  
             
                  
                
                
                 
                   
                   
              
            
                    
                     
              
                
                        
                    
                 
                
                 
                
                                      
                      
                           
                   
                         
                    
                                           
                              
                   
                       
                        
                     
                    
                       
                
              
                                                   
                   
                                 
                     
                     
                                            
                               
                    
                    
                   
                
                                             
                     
                        
                       
                    
                 
                         
                                         
                     
             
                      
                                           
                  
                   
                 
                  
                                                  
                      
                       
                            
                      
 

const en            = {
  dir: "ltr",
  date: "Date",
  week: "Week",
  member: "Member",
  members: "Members",
  project: "Project",
  projects: "Projects",
  client: "Client",
  team: "Team",
  hours: "Hours",
  tracked: "Tracked",
  manual: "Manual",
  rate: "Rate",
  amount: "Amount",
  total: "Total",
  subtotal: "Subtotal",
  tax: "Tax",
  currency: "Currency",
  notSet: "Not set",
  varies: "Varies",
  perHour: "hour",
  hoursAxis: "Hours",
  generated: "Generated",
  page: "Page",
  of: "of",
  allMembers: "All members",
  allProjects: "All projects",
  from: "From",
  billTo: "Bill to",
  documentNumber: "Document no.",
  dateIssued: "Date of issue",
  dateDue: "Date due",
  period: "Period",
  dueWord: "due",
  teamTitle: (group) => `Time & Activity by ${group}`,
  teamSubtitle: "Time worked and activity levels for the selected filters.",
  teamSubtitleMoney: "Time worked, activity levels, and amounts earned for the selected filters.",
  totalTime: "Total time",
  averageActivity: "Average activity",
  totalSpent: "Total spent",
  trackedHoursBy: (group) => `Tracked hours by ${group.toLowerCase()}`,
  trackedHoursByMember: "Tracked hours by member",
  groupedBy: "Grouped by",
  filterMembers: "Members",
  filterProjects: "Projects",
  trackedTime: "Tracked time",
  manualTime: "Manual time",
  activityLevel: "Activity level",
  active: "Active",
  idle: "Idle",
  allDetail: (kind) => (kind === "member" ? "All members" : "All projects"),
  emptyTeam: "No data for this range.",
  columns: {},
  clientTitle: "Client statement",
  clientSubtitle: (client) => `Time worked for ${client} and what it comes to.`,
  clientSubtitleGeneric: "Time worked on the selected projects and what it comes to.",
  totalHours: "Total hours",
  hourlyRate: "Hourly rate",
  amountDue: "Amount due",
  issued: "Issued",
  due: (date, days) => `Due: ${date} (net ${days} days)`,
  hoursByDate: "Hours by date",
  hoursByProject: "Hours by project",
  hoursByMember: "Hours by member",
  noteAmount: "Amount is the hours worked on each project multiplied by that project's client hourly rate.",
  noteTax: "Tax is worked out on each client's own rate, from its invoice terms.",
  noteTermsDiffer: "The clients on this statement have different payment terms, so no single due date is given.",
  noteUnpriced: (names) =>
    `No client hourly rate is set for: ${names}. Their hours are listed but not priced. ` +
    "Set the rate on the project (General > Client hourly rate) and export again.",
  emptyClient: "No time was tracked on these projects in this range.",
  payslipTitle: "Pay slip",
  payslipSubtitle: (name) => `Hours worked by ${name} and the pay they come to.`,
  employee: "Employee",
  payPeriod: "Pay period",
  payRate: "Pay rate",
  grossPay: "Gross pay",
  daysWorked: (n, shown) => `${shown} ${n === 1 ? "day" : "days"} worked`,
  notePayGross:
    "Gross pay is the hours worked each day multiplied by the hourly pay rate set for this member on the Members page. " +
    "Taxes, deductions and anything already paid are not included.",
  notePayNoRate:
    "No pay rate is set for this member, so the hours are listed without an amount. Set it on the Members page and export again.",
  notePayRateChanged: "The pay rate changed during this period; each day uses the rate that applied on that day.",
  emptyPayslip: "No time was tracked by this member in this range.",
}

const ar            = {
  dir: "rtl",
  date: "التاريخ",
  week: "الأسبوع",
  member: "العضو",
  members: "الأعضاء",
  project: "المشروع",
  projects: "المشاريع",
  client: "العميل",
  team: "الفريق",
  hours: "الساعات",
  tracked: "المسجّل",
  manual: "اليدوي",
  rate: "السعر",
  amount: "المبلغ",
  total: "الإجمالي",
  subtotal: "المجموع الفرعي",
  tax: "الضريبة",
  currency: "العملة",
  notSet: "غير محدد",
  varies: "متغير",
  perHour: "ساعة",
  hoursAxis: "الساعات",
  generated: "تم الإنشاء",
  page: "صفحة",
  of: "من",
  allMembers: "كل الأعضاء",
  allProjects: "كل المشاريع",
  from: "من",
  billTo: "إلى",
  documentNumber: "رقم المستند",
  dateIssued: "تاريخ الإصدار",
  dateDue: "تاريخ الاستحقاق",
  period: "الفترة",
  dueWord: "مستحق في",
  teamTitle: (group) => `تقرير الوقت والنشاط حسب ${group}`,
  teamSubtitle: "الوقت المُنجز ومستويات النشاط وفق عوامل التصفية المحددة.",
  teamSubtitleMoney: "الوقت المُنجز ومستويات النشاط والمبالغ المكتسبة وفق عوامل التصفية المحددة.",
  totalTime: "إجمالي الوقت",
  averageActivity: "متوسط النشاط",
  totalSpent: "إجمالي المصروف",
  trackedHoursBy: (group) => `الساعات المسجّلة حسب ${group}`,
  trackedHoursByMember: "الساعات المسجّلة حسب العضو",
  groupedBy: "مجمّعة حسب",
  filterMembers: "الأعضاء",
  filterProjects: "المشاريع",
  trackedTime: "الوقت المسجّل",
  manualTime: "الوقت اليدوي",
  activityLevel: "مستوى النشاط",
  active: "النشط",
  idle: "الخمول",
  allDetail: (kind) => (kind === "member" ? "كل الأعضاء" : "كل المشاريع"),
  emptyTeam: "لا توجد بيانات لهذه الفترة.",
  columns: {
    client: "العميل",
    team: "الفريق",
    todo: "المهمة",
    project: "المشاريع",
    regular_hours: "الساعات العادية",
    break_time: "وقت الاستراحة",
    manual_hours: "الساعات اليدوية",
    total_hours: "إجمالي الساعات",
    activity_pct: "النشاط",
    idle_pct: "نسبة الخمول",
    idle_hr: "ساعات الخمول",
    total_spent: "إجمالي المصروف",
    __members: "الأعضاء",
  },
  clientTitle: "كشف حساب العميل",
  clientSubtitle: (client) => `الوقت المُنجز للعميل ${client} وما يبلغه.`,
  clientSubtitleGeneric: "الوقت المُنجز على المشاريع المحددة وما يبلغه.",
  totalHours: "إجمالي الساعات",
  hourlyRate: "سعر الساعة",
  amountDue: "المبلغ المستحق",
  issued: "تاريخ الإصدار",
  due: (date, days) => `تاريخ الاستحقاق: ${date} (صافي ${days} يوماً)`,
  hoursByDate: "الساعات حسب التاريخ",
  hoursByProject: "الساعات حسب المشروع",
  hoursByMember: "الساعات حسب العضو",
  noteAmount: "المبلغ هو ساعات العمل على كل مشروع مضروبة في سعر الساعة المتفق عليه مع العميل لهذا المشروع.",
  noteTax: "تُحسب الضريبة بحسب نسبة كل عميل الواردة في شروط فواتيره.",
  noteTermsDiffer: "تختلف شروط الدفع بين العملاء في هذا الكشف، لذلك لا يُذكر تاريخ استحقاق واحد.",
  noteUnpriced: (names) =>
    `لم يُحدَّد سعر ساعة للعميل للمشاريع التالية: ${names}. تُعرض ساعاتها دون تسعير. ` +
    "حدّد السعر في المشروع (عام > سعر ساعة العميل) ثم صدّر الكشف مجدداً.",
  emptyClient: "لم يُسجَّل وقت على هذه المشاريع في هذه الفترة.",
  payslipTitle: "قسيمة الراتب",
  payslipSubtitle: (name) => `ساعات العمل التي أنجزها ${name} والأجر المستحق عنها.`,
  employee: "الموظف",
  payPeriod: "فترة الدفع",
  payRate: "أجر الساعة",
  grossPay: "إجمالي الأجر",
  daysWorked: (_n, shown) => `أيام العمل: ${shown}`,
  notePayGross:
    "إجمالي الأجر هو ساعات العمل في كل يوم مضروبة في أجر الساعة المحدد لهذا العضو في صفحة الأعضاء. " +
    "لا يشمل الضرائب أو الخصومات أو المبالغ المدفوعة سابقاً.",
  notePayNoRate: "لا يوجد أجر ساعة محدد لهذا العضو، لذلك تُعرض الساعات دون مبلغ. حدّده في صفحة الأعضاء ثم صدّر القسيمة مجدداً.",
  notePayRateChanged: "تغيّر أجر الساعة خلال هذه الفترة؛ يُستخدم لكل يوم الأجر الساري في ذلك اليوم.",
  emptyPayslip: "لم يسجّل هذا العضو وقتاً في هذه الفترة.",
}

const LABELS                                 = { en, ar }

export function getLabels(language             )            {
  return LABELS[language] ?? en
}
