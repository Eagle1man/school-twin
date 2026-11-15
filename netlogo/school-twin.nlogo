;; ЦИФРОВОЙ ДВОЙНИК ШКОЛЫ — порт правил принятия решений в NetLogo.
;;
;; Что делает модель: читает фикстуру, подготовленную JS-движком
;; (netlogo/export-fixture.mjs), применяет одно из трёх решений к занятиям,
;; которых коснулось отсутствие учителей, и считает последствия по неделе:
;; непроведённые занятия, замены, переработку и расходы.
;;
;; Чего модель не делает: не строит расписание и не проверяет помещения.
;; Расписание строит JS-движок; NetLogo проверяет, что те же правила дают
;; те же числа. Это и есть предмет сверки (tests/parity.test.mjs).
;;
;; Запуск в NetLogo Desktop:
;;   1. File → Open → school-twin.nlogo
;;   2. в Command Center: setup
;;   3. затем: run-all-policies
;;   4. результат: netlogo/results.csv
;;
;; СТАТУС: модель НЕ ПРОВЕРЕНА запуском — NetLogo на машине разработки
;; не установлен. Пока сверка не выполнена, считать её доказанной нельзя.

extensions [csv]

globals [
  lesson-rows          ; занятия одной недели (строки CSV)
  teacher-rows         ; учителя: id, maxWeekly, hourRate
  subject-teachers     ; пары «предмет — учитель»
  absence-rows         ; отсутствия: учитель, неделя
  config-rows          ; ставки и резерв
  policy-choice        ; "cancel" | "substitute" | "reassign"
  resolved             ; "id|status|teacher"
  busy                 ; "week|day|slot|teacher"
  loads                ; [[teacherId, часы]]
  missed-count
  substituted-count
  extra-hours
  total-cost
  out-rows
]

to setup
  clear-all
  set lesson-rows but-first csv:from-file "fixture/lessons.csv"
  set teacher-rows but-first csv:from-file "fixture/teachers.csv"
  set subject-teachers but-first csv:from-file "fixture/teacher-subjects.csv"
  set absence-rows but-first csv:from-file "fixture/absences.csv"
  set config-rows but-first csv:from-file "fixture/config.csv"
  set policy-choice "cancel"
  set out-rows []
  reset-ticks
  print (word "Фикстура: занятий " length lesson-rows ", отсутствуют " length absence-rows)
end

;; --- одно решение на все затронутые занятия ---------------------------------

to run-model
  set resolved []
  set busy []
  set loads []
  foreach teacher-rows [ t -> set loads lput (list (item 0 t) 0) loads ]
  set missed-count 0
  set substituted-count 0
  set extra-hours 0
  set total-cost 0

  foreach lesson-rows [ l ->
    if (read-from-string item 9 l) = 1 [ handle-lesson l ]
  ]

  ;; Переработка: часы сверх недельной нормы, по каждому учителю.
  foreach loads [ p ->
    let tid first p
    let hours last p
    let row first filter [ t -> item 0 t = tid ] teacher-rows
    if not empty? row [
      let maxw read-from-string item 2 row
      if hours > maxw [ set extra-hours extra-hours + (hours - maxw) ]
    ]
  ]
  set total-cost total-cost + extra-hours * cfg "hourRate" * (cfg "overtimeFactor" - 1)
end

to handle-lesson [l]
  let id item 0 l
  let subject item 2 l
  let teacher item 3 l
  let w read-from-string item 6 l
  let d read-from-string item 7 l
  let s read-from-string item 8 l

  ifelse policy-choice = "cancel"
  [
    set missed-count missed-count + 1
    set resolved lput (word id "|missed|" teacher) resolved
  ]
  [
    ifelse policy-choice = "substitute"
    [
      set substituted-count substituted-count + 1
      set total-cost total-cost + cfg "substitutionRate"
      set resolved lput (word id "|substituted|SUB") resolved
    ]
    [
      let candidates remove-duplicates map [ p -> item 1 p ] filter [ p -> item 0 p = subject ] subject-teachers
      let free-ids filter [ tid -> (not absent? tid w) and (not busy? tid w d s) ] candidates
      ifelse empty? free-ids
      [
        set missed-count missed-count + 1
        set resolved lput (word id "|missed|" teacher) resolved
      ]
      [
        ;; Тот же порядок выбора, что в JS: меньше всего часов, при равенстве — id по алфавиту.
        let best first sort-by [ [a b] ->
          (load-of a) < (load-of b) or ((load-of a) = (load-of b) and a < b)
        ] free-ids
        set loads map [ p -> ifelse-value (first p = best) [ list best (last p + 1) ] [ p ] ] loads
        set busy lput (word w "|" d "|" s "|" best) busy
        set resolved lput (word id "|held|" best) resolved
      ]
    ]
  ]
end

;; --- вспомогательные -------------------------------------------------------

to-report absent? [tid w]
  report not empty? filter [ a -> (item 0 a = tid) and (read-from-string item 1 a = w) ] absence-rows
end

to-report busy? [tid w d s]
  report member? (word w "|" d "|" s "|" tid) busy
end

to-report load-of [tid]
  let row filter [ p -> first p = tid ] loads
  ifelse empty? row [ report 0 ] [ report last first row ]
end

to-report cfg [key]
  let row filter [ r -> item 0 r = key ] config-rows
  ifelse empty? row [ report 0 ] [ report read-from-string item 1 first row ]
end

;; --- прогон всех трёх решений и выгрузка ------------------------------------

to run-all-policies
  set out-rows []
  foreach ["cancel" "substitute" "reassign"] [ p ->
    set policy-choice p
    run-model
    set out-rows lput (word p "," missed-count "," substituted-count "," extra-hours "," total-cost) out-rows
  ]
  file-open "results.csv"
  file-print "policy,missed,substituted,extra-hours,cost"
  foreach out-rows [ r -> file-print r ]
  file-close
  print "results.csv записан"
  foreach out-rows [ r -> print r ]
end
