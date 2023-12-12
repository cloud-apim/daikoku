"use strict";(self.webpackChunkdaikoku_documentation=self.webpackChunkdaikoku_documentation||[]).push([[7581],{3725:(e,o,n)=>{n.r(o),n.d(o,{assets:()=>d,contentTitle:()=>s,default:()=>u,frontMatter:()=>t,metadata:()=>r,toc:()=>l});var i=n(5893),a=n(1151);const t={},s="Deploy to production",r={id:"guides/deploy",title:"Deploy to production",description:"Now it's time to deploy Daikoku in production, in this chapter we will see what kind of things you can do.",source:"@site/docs/03-guides/13-deploy.md",sourceDirName:"03-guides",slug:"/guides/deploy",permalink:"/daikoku/devmanual/docs/guides/deploy",draft:!1,unlisted:!1,tags:[],version:"current",sidebarPosition:13,frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Admin REST API",permalink:"/daikoku/devmanual/docs/guides/apis"}},d={},l=[{value:"Deploy with Docker",id:"deploy-with-docker",level:2},{value:"Deploy manually",id:"deploy-manually",level:2}];function c(e){const o={a:"a",code:"code",h1:"h1",h2:"h2",p:"p",pre:"pre",...(0,a.a)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(o.h1,{id:"deploy-to-production",children:"Deploy to production"}),"\n",(0,i.jsx)(o.p,{children:"Now it's time to deploy Daikoku in production, in this chapter we will see what kind of things you can do."}),"\n",(0,i.jsx)(o.h2,{id:"deploy-with-docker",children:"Deploy with Docker"}),"\n",(0,i.jsx)(o.p,{children:"Daikoku is available as a Docker image on DockerHub so you can just use it in any Docker compatible environment"}),"\n",(0,i.jsx)(o.pre,{children:(0,i.jsx)(o.code,{className:"language-sh",children:'docker run -p "8080:8080" maif/daikoku\n'})}),"\n",(0,i.jsx)(o.p,{children:"You can also pass useful args like :"}),"\n",(0,i.jsx)(o.pre,{children:(0,i.jsx)(o.code,{children:'docker run -p "8080:8080" daikoku -Dconfig.file=/usr/app/daikoku/conf/daikoku.conf -Dlogger.file=/usr/app/daikoku/conf/daikoku.xml\n'})}),"\n",(0,i.jsxs)(o.p,{children:["If you want to provide your own config file, you can read ",(0,i.jsx)(o.a,{href:"/daikoku/devmanual/docs/getstarted/firstrun/configfile",children:"the documentation about config files"}),"."]}),"\n",(0,i.jsxs)(o.p,{children:["You can also provide some ENV variable using the ",(0,i.jsx)(o.code,{children:"--env"})," flag to customize your Daikoku instance."]}),"\n",(0,i.jsxs)(o.p,{children:["The list of possible env variables is available ",(0,i.jsx)(o.a,{href:"/daikoku/devmanual/docs/getstarted/firstrun/env",children:"here"}),"."]}),"\n",(0,i.jsx)(o.p,{children:"You can use a volume to provide configuration like :"}),"\n",(0,i.jsx)(o.pre,{children:(0,i.jsx)(o.code,{className:"language-sh",children:'docker run -p "8080:8080" -v "$(pwd):/usr/app/daikoku/conf" maif/daikoku\n'})}),"\n",(0,i.jsx)(o.p,{children:"You can also use a volume if you choose to use exports files :"}),"\n",(0,i.jsx)(o.pre,{children:(0,i.jsx)(o.code,{className:"language-sh",children:'docker run -p "8080:8080" -v "$(pwd):/usr/app/daikoku/imports" maif/daikoku -Ddaikoku.init.data.from=/usr/app/daikoku/imports/export.ndjson\n'})}),"\n",(0,i.jsx)(o.h2,{id:"deploy-manually",children:"Deploy manually"}),"\n",(0,i.jsxs)(o.p,{children:["As Daikoku is a PlayFramwork application, you can follow the ",(0,i.jsx)(o.a,{href:"https://www.playframework.com/documentation/2.6.x/Production",children:"PlayFramework documentation"})," to deploy your application."]})]})}function u(e={}){const{wrapper:o}={...(0,a.a)(),...e.components};return o?(0,i.jsx)(o,{...e,children:(0,i.jsx)(c,{...e})}):c(e)}},1151:(e,o,n)=>{n.d(o,{Z:()=>r,a:()=>s});var i=n(7294);const a={},t=i.createContext(a);function s(e){const o=i.useContext(t);return i.useMemo((function(){return"function"==typeof e?e(o):{...o,...e}}),[o,e])}function r(e){let o;return o=e.disableParentContext?"function"==typeof e.components?e.components(a):e.components||a:s(e.components),i.createElement(t.Provider,{value:o},e.children)}}}]);