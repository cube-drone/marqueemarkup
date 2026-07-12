# vim-marquee

Vim syntax highlighting for [Marquee](https://github.com/cube-drone/marqueemarkup) (`.mq`).

Install with any plugin manager pointed at this directory, or the classic way:

```
mkdir -p ~/.vim/syntax ~/.vim/ftdetect
cp syntax/marquee.vim ~/.vim/syntax/
cp ftdetect/marquee.vim ~/.vim/ftdetect/
```

(Neovim: `~/.config/nvim/` instead of `~/.vim/`.)

Line-level constructs (directives, headings, comments, fences, quotes, lists) are exact;
inline emphasis is a one-line approximation. Colors map to standard highlight groups, so it
follows whatever colorscheme you already like.
