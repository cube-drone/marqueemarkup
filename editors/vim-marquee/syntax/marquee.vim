" Vim syntax for the Marquee markup language (.mq)
" https://github.com/cube-drone/marqueemarkup
"
" Line-level constructs are exact (Marquee's block grammar is line-oriented
" on purpose); inline emphasis is a oneline approximation - a span wrapped
" across source lines colors its tags but not its interior, which degrades
" politely, in the house style.

if exists("b:current_syntax")
  finish
endif

" ---- inline ----
syn match  mqEscape    /\\[!-\/:-@[-`{-~]/
syn region mqCodeSpan  start=/`/ end=/`/ oneline
syn region mqBold      start=/\*\*\ze\S/ end=/\S\zs\*\*/ oneline contains=mqCodeSpan,mqEscape,mqEmoji
syn region mqItalic    start=/\*\ze[^* \t]/ end=/[^* \t]\zs\*\*\@!/ oneline contains=mqCodeSpan,mqEscape,mqEmoji
syn region mqStrike    start=/\~\~\ze\S/ end=/\S\zs\~\~/ oneline contains=mqCodeSpan,mqEscape
syn match  mqEmoji     /:[a-z0-9_+-]\{1,64}:/
syn match  mqSpanTag   /\[\/\?[a-z][a-z0-9_-]*\(\(=\|[ \t]\)[^\]]*\)\?\]\((\)\@!/ contains=mqAttrString
syn match  mqLink      /\[[^\]]*\]([^) \t]*)/ contains=mqLinkTarget
syn match  mqLinkTarget /([^) \t]*)/ contained
syn match  mqTurbolink /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S\+$/

" ---- blocks ----
syn match  mqComment   /^%%.*$/
syn match  mqShebang   /^#!marquee \d\+$/
syn match  mqHeading   /^#\{1,8} .*$/ contains=mqBold,mqItalic,mqStrike,mqCodeSpan,mqSpanTag,mqEmoji,mqEscape
syn match  mqBreak     /^---[ \t]*$/
syn match  mqQuote     /^\(> \?\)\+/
syn match  mqListMark  /^[ ]*\([-*+]\|\d\+\.\)[ ]\@=/
syn match  mqAttrString /"\([^"\\]\|\\["\\]\)*"/ contained
syn match  mqDirective /^:::[a-z][a-z0-9_-]*.*$/ contains=mqAttrString
syn match  mqDirClose  /^:::\([ \t]\+[a-z][a-z0-9_-]*\)\?[ \t]*$/
syn region mqFence     start=/^```/ end=/^```\+[ \t]*$/ keepend

" ---- colors: standard groups so every colorscheme just works ----
hi def link mqComment    Comment
hi def link mqShebang    PreProc
hi def link mqHeading    Title
hi def link mqBreak      Delimiter
hi def link mqQuote      Comment
hi def link mqListMark   Delimiter
hi def link mqDirective  Statement
hi def link mqDirClose   Statement
hi def link mqAttrString String
hi def link mqFence      String
hi def link mqCodeSpan   String
hi def link mqSpanTag    Function
hi def link mqLink       Underlined
hi def link mqLinkTarget Underlined
hi def link mqTurbolink  Underlined
hi def link mqEmoji      Special
hi def link mqEscape     SpecialChar
hi def      mqBold       term=bold cterm=bold gui=bold
hi def      mqItalic     term=italic cterm=italic gui=italic
hi def      mqStrike     term=strikethrough cterm=strikethrough gui=strikethrough

let b:current_syntax = "marquee"
