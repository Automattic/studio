<?php
/** Adminer Editor - Compact database editor
* @link https://www.adminer.org/
* @author Jakub Vrana, https://www.vrana.cz/
* @copyright 2009 Jakub Vrana
* @license https://www.apache.org/licenses/LICENSE-2.0 Apache License, Version 2.0
* @license https://www.gnu.org/licenses/gpl-2.0.html GNU General Public License, version 2 (one or other)
* @version 5.1.1
*/namespace
Adminer;const
VERSION="5.1.1";error_reporting(24575);set_error_handler(function($Ub,$Vb){return!!preg_match('~^Undefined (array key|offset|index)~',$Vb);},E_WARNING|E_NOTICE);$lc=!preg_match('~^(unsafe_raw)?$~',ini_get("filter.default"));if($lc||ini_get("filter.default_flags")){foreach(array('_GET','_POST','_COOKIE','_SERVER')as$X){$Hg=filter_input_array(constant("INPUT$X"),FILTER_UNSAFE_RAW);if($Hg)$$X=$Hg;}}if(function_exists("mb_internal_encoding"))mb_internal_encoding("8bit");function
connection($h=null){return($h?:Db::$md);}function
adminer(){return
Adminer::$md;}function
driver(){return
Driver::$md;}function
connect(array$lb){$H=Driver::connect($lb[0],$lb[1],$lb[2]);return(is_object($H)?$H:null);}function
idf_unescape($t){if(!preg_match('~^[`\'"[]~',$t))return$t;$Ad=substr($t,-1);return
str_replace($Ad.$Ad,$Ad,substr($t,1,-1));}function
q($Q){return
connection()->quote($Q);}function
escape_string($X){return
substr(q($X),1,-1);}function
idx($na,$w,$j=null){return($na&&array_key_exists($w,$na)?$na[$w]:$j);}function
number($X){return
preg_replace('~[^0-9]+~','',$X);}function
number_type(){return'((?<!o)int(?!er)|numeric|real|float|double|decimal|money)';}function
remove_slashes(array$Xe,$lc=false){if(function_exists("get_magic_quotes_gpc")&&get_magic_quotes_gpc()){while(list($w,$X)=each($Xe)){foreach($X
as$ud=>$W){unset($Xe[$w][$ud]);if(is_array($W)){$Xe[$w][stripslashes($ud)]=$W;$Xe[]=&$Xe[$w][stripslashes($ud)];}else$Xe[$w][stripslashes($ud)]=($lc?$W:stripslashes($W));}}}}function
bracket_escape($t,$wa=false){static$sg=array(':'=>':1',']'=>':2','['=>':3','"'=>':4');return
strtr($t,($wa?array_flip($sg):$sg));}function
min_version($Tg,$Kd="",$h=null){$h=connection($h);$Df=$h->server_info;if($Kd&&preg_match('~([\d.]+)-MariaDB~',$Df,$_)){$Df=$_[1];$Tg=$Kd;}return$Tg&&version_compare($Df,$Tg)>=0;}function
charset(Db$g){return(min_version("5.5.3",0,$g)?"utf8mb4":"utf8");}function
ini_bool($hd){$X=ini_get($hd);return(preg_match('~^(on|true|yes)$~i',$X)||(int)$X);}function
sid(){static$H;if($H===null)$H=(SID&&!($_COOKIE&&ini_bool("session.use_cookies")));return$H;}function
set_password($Sg,$M,$V,$D){$_SESSION["pwds"][$Sg][$M][$V]=($_COOKIE["adminer_key"]&&is_string($D)?array(encrypt_string($D,$_COOKIE["adminer_key"])):$D);}function
get_password(){$H=get_session("pwds");if(is_array($H))$H=($_COOKIE["adminer_key"]?decrypt_string($H[0],$_COOKIE["adminer_key"]):false);return$H;}function
get_val($F,$l=0,$bb=null){$bb=connection($bb);$G=$bb->query($F);if(!is_object($G))return
false;$I=$G->fetch_row();return($I?$I[$l]:false);}function
get_vals($F,$d=0){$H=array();$G=connection()->query($F);if(is_object($G)){while($I=$G->fetch_row())$H[]=$I[$d];}return$H;}function
get_key_vals($F,$h=null,$Gf=true){$h=connection($h);$H=array();$G=$h->query($F);if(is_object($G)){while($I=$G->fetch_row()){if($Gf)$H[$I[0]]=$I[1];else$H[]=$I[0];}}return$H;}function
get_rows($F,$h=null,$k="<p class='error'>"){$bb=connection($h);$H=array();$G=$bb->query($F);if(is_object($G)){while($I=$G->fetch_assoc())$H[]=$I;}elseif(!$G&&!$h&&$k&&(defined('Adminer\PAGE_HEADER')||$k=="-- "))echo$k.error()."\n";return$H;}function
unique_array($I,array$v){foreach($v
as$u){if(preg_match("~PRIMARY|UNIQUE~",$u["type"])){$H=array();foreach($u["columns"]as$w){if(!isset($I[$w]))continue
2;$H[$w]=$I[$w];}return$H;}}}function
escape_key($w){if(preg_match('(^([\w(]+)('.str_replace("_",".*",preg_quote(idf_escape("_"))).')([ \w)]+)$)',$w,$_))return$_[1].idf_escape(idf_unescape($_[2])).$_[3];return
idf_escape($w);}function
where(array$Z,array$m=array()){$H=array();foreach((array)$Z["where"]as$w=>$X){$w=bracket_escape($w,true);$d=escape_key($w);$l=idx($m,$w,array());$ic=$l["type"];$H[]=$d.(JUSH=="sql"&&$ic=="json"?" = CAST(".q($X)." AS JSON)":(JUSH=="sql"&&is_numeric($X)&&preg_match('~\.~',$X)?" LIKE ".q($X):(JUSH=="mssql"&&strpos($ic,"datetime")===false?" LIKE ".q(preg_replace('~[_%[]~','[\0]',$X)):" = ".unconvert_field($l,q($X)))));if(JUSH=="sql"&&preg_match('~char|text~',$ic)&&preg_match("~[^ -@]~",$X))$H[]="$d = ".q($X)." COLLATE ".charset(connection())."_bin";}foreach((array)$Z["null"]as$w)$H[]=escape_key($w)." IS NULL";return
implode(" AND ",$H);}function
where_check($X,array$m=array()){parse_str($X,$La);remove_slashes(array(&$La));return
where($La,$m);}function
where_link($r,$d,$Y,$se="="){return"&where%5B$r%5D%5Bcol%5D=".urlencode($d)."&where%5B$r%5D%5Bop%5D=".urlencode(($Y!==null?$se:"IS NULL"))."&where%5B$r%5D%5Bval%5D=".urlencode($Y);}function
convert_fields(array$e,array$m,array$K=array()){$H="";foreach($e
as$w=>$X){if($K&&!in_array(idf_escape($w),$K))continue;$oa=convert_field($m[$w]);if($oa)$H
.=", $oa AS ".idf_escape($w);}return$H;}function
cookie($B,$Y,$Ed=2592000){header("Set-Cookie: $B=".urlencode($Y).($Ed?"; expires=".gmdate("D, d M Y H:i:s",time()+$Ed)." GMT":"")."; path=".preg_replace('~\?.*~','',$_SERVER["REQUEST_URI"]).(HTTPS?"; secure":"")."; HttpOnly; SameSite=lax",false);}function
get_settings($ib){parse_str($_COOKIE[$ib],$Hf);return$Hf;}function
get_setting($w,$ib="adminer_settings"){$Hf=get_settings($ib);return$Hf[$w];}function
save_settings(array$Hf,$ib="adminer_settings"){cookie($ib,http_build_query($Hf+get_settings($ib)));}function
restart_session(){if(!ini_bool("session.use_cookies")&&(!function_exists('session_status')||session_status()==1))session_start();}function
stop_session($sc=false){$Og=ini_bool("session.use_cookies");if(!$Og||$sc){session_write_close();if($Og&&@ini_set("session.use_cookies",'0')===false)session_start();}}function&get_session($w){return$_SESSION[$w][DRIVER][SERVER][$_GET["username"]];}function
set_session($w,$X){$_SESSION[$w][DRIVER][SERVER][$_GET["username"]]=$X;}function
auth_url($Sg,$M,$V,$i=null){$Lg=remove_from_uri(implode("|",array_keys(SqlDriver::$Cb))."|username|ext|".($i!==null?"db|":"").($Sg=='mssql'||$Sg=='pgsql'?"":"ns|").session_name());preg_match('~([^?]*)\??(.*)~',$Lg,$_);return"$_[1]?".(sid()?SID."&":"").($Sg!="server"||$M!=""?urlencode($Sg)."=".urlencode($M)."&":"").($_GET["ext"]?"ext=".urlencode($_GET["ext"])."&":"")."username=".urlencode($V).($i!=""?"&db=".urlencode($i):"").($_[2]?"&$_[2]":"");}function
is_ajax(){return($_SERVER["HTTP_X_REQUESTED_WITH"]=="XMLHttpRequest");}function
redirect($Gd,$Td=null){if($Td!==null){restart_session();$_SESSION["messages"][preg_replace('~^[^?]*~','',($Gd!==null?$Gd:$_SERVER["REQUEST_URI"]))][]=$Td;}if($Gd!==null){if($Gd=="")$Gd=".";header("Location: $Gd");exit;}}function
query_redirect($F,$Gd,$Td,$ff=true,$Zb=true,$ec=false,$ig=""){if($Zb){$Rf=microtime(true);$ec=!connection()->query($F);$ig=format_time($Rf);}$Of=($F?adminer()->messageQuery($F,$ig,$ec):"");if($ec){adminer()->error
.=error().$Of.script("messagesPrint();")."<br>";return
false;}if($ff)redirect($Gd,$Td.$Of);return
true;}class
Queries{static$af=array();static$Rf=0;}function
queries($F){if(!Queries::$Rf)Queries::$Rf=microtime(true);Queries::$af[]=(preg_match('~;$~',$F)?"DELIMITER ;;\n$F;\nDELIMITER ":$F).";";return
connection()->query($F);}function
apply_queries($F,array$T,$Wb='Adminer\table'){foreach($T
as$R){if(!queries("$F ".$Wb($R)))return
false;}return
true;}function
queries_redirect($Gd,$Td,$ff){$af=implode("\n",Queries::$af);$ig=format_time(Queries::$Rf);return
query_redirect($af,$Gd,$Td,$ff,false,!$ff,$ig);}function
format_time($Rf){return
lang(0,max(0,microtime(true)-$Rf));}function
relative_uri(){return
str_replace(":","%3a",preg_replace('~^[^?]*/([^?]*)~','\1',$_SERVER["REQUEST_URI"]));}function
remove_from_uri($He=""){return
substr(preg_replace("~(?<=[?&])($He".(SID?"":"|".session_name()).")=[^&]*&~",'',relative_uri()."&"),0,-1);}function
get_file($w,$tb=false,$vb=""){$jc=$_FILES[$w];if(!$jc)return
null;foreach($jc
as$w=>$X)$jc[$w]=(array)$X;$H='';foreach($jc["error"]as$w=>$k){if($k)return$k;$B=$jc["name"][$w];$pg=$jc["tmp_name"][$w];$gb=file_get_contents($tb&&preg_match('~\.gz$~',$B)?"compress.zlib://$pg":$pg);if($tb){$Rf=substr($gb,0,3);if(function_exists("iconv")&&preg_match("~^\xFE\xFF|^\xFF\xFE~",$Rf))$gb=iconv("utf-16","utf-8",$gb);elseif($Rf=="\xEF\xBB\xBF")$gb=substr($gb,3);}$H
.=$gb;if($vb)$H
.=(preg_match("($vb\\s*\$)",$gb)?"":$vb)."\n\n";}return$H;}function
upload_error($k){$Pd=($k==UPLOAD_ERR_INI_SIZE?ini_get("upload_max_filesize"):0);return($k?lang(1).($Pd?" ".lang(2,$Pd):""):lang(3));}function
repeat_pattern($Le,$x){return
str_repeat("$Le{0,65535}",$x/65535)."$Le{0,".($x%65535)."}";}function
is_utf8($X){return(preg_match('~~u',$X)&&!preg_match('~[\0-\x8\xB\xC\xE-\x1F]~',$X));}function
format_number($X){return
strtr(number_format($X,0,".",lang(4)),preg_split('~~u',lang(5),-1,PREG_SPLIT_NO_EMPTY));}function
friendly_url($X){return
preg_replace('~\W~i','-',$X);}function
table_status1($R,$fc=false){$H=table_status($R,$fc);return($H?reset($H):array("Name"=>$R));}function
column_foreign_keys($R){$H=array();foreach(adminer()->foreignKeys($R)as$o){foreach($o["source"]as$X)$H[$X][]=$o;}return$H;}function
fields_from_edit(){$H=array();foreach((array)$_POST["field_keys"]as$w=>$X){if($X!=""){$X=bracket_escape($X);$_POST["function"][$X]=$_POST["field_funs"][$w];$_POST["fields"][$X]=$_POST["field_vals"][$w];}}foreach((array)$_POST["fields"]as$w=>$X){$B=bracket_escape($w,true);$H[$B]=array("field"=>$B,"privileges"=>array("insert"=>1,"update"=>1,"where"=>1,"order"=>1),"null"=>1,"auto_increment"=>($w==driver()->primary),);}return$H;}function
dump_headers($Xc,$Zd=false){$H=adminer()->dumpHeaders($Xc,$Zd);$De=$_POST["output"];if($De!="text")header("Content-Disposition: attachment; filename=".adminer()->dumpFilename($Xc).".$H".($De!="file"&&preg_match('~^[0-9a-z]+$~',$De)?".$De":""));session_write_close();if(!ob_get_level())ob_start(null,4096);ob_flush();flush();return$H;}function
dump_csv(array$I){foreach($I
as$w=>$X){if(preg_match('~["\n,;\t]|^0|\.\d*0$~',$X)||$X==="")$I[$w]='"'.str_replace('"','""',$X).'"';}echo
implode(($_POST["format"]=="csv"?",":($_POST["format"]=="tsv"?"\t":";")),$I)."\r\n";}function
apply_sql_function($q,$d){return($q?($q=="unixepoch"?"DATETIME($d, '$q')":($q=="count distinct"?"COUNT(DISTINCT ":strtoupper("$q("))."$d)"):$d);}function
get_temp_dir(){$H=ini_get("upload_tmp_dir");if(!$H){if(function_exists('sys_get_temp_dir'))$H=sys_get_temp_dir();else{$n=@tempnam("","");if(!$n)return'';$H=dirname($n);unlink($n);}}return$H;}function
file_open_lock($n){if(is_link($n))return;$p=@fopen($n,"c+");if(!$p)return;chmod($n,0660);if(!flock($p,LOCK_EX)){fclose($p);return;}return$p;}function
file_write_unlock($p,$qb){rewind($p);fwrite($p,$qb);ftruncate($p,strlen($qb));file_unlock($p);}function
file_unlock($p){flock($p,LOCK_UN);fclose($p);}function
first(array$na){return
reset($na);}function
password_file($jb){$n=get_temp_dir()."/adminer.key";if(!$jb&&!file_exists($n))return'';$p=file_open_lock($n);if(!$p)return'';$H=stream_get_contents($p);if(!$H){$H=rand_string();file_write_unlock($p,$H);}else
file_unlock($p);return$H;}function
rand_string(){return
md5(uniqid(strval(mt_rand()),true));}function
select_value($X,$z,array$l,$gg){if(is_array($X)){$H="";foreach($X
as$ud=>$W)$H
.="<tr>".($X!=array_values($X)?"<th>".h($ud):"")."<td>".select_value($W,$z,$l,$gg);return"<table>$H</table>";}if(!$z)$z=adminer()->selectLink($X,$l);if($z===null){if(is_mail($X))$z="mailto:$X";if(is_url($X))$z=$X;}$H=adminer()->editVal($X,$l);if($H!==null){if(!is_utf8($H))$H="\0";elseif($gg!=""&&is_shortable($l))$H=shorten_utf8($H,max(0,+$gg));else$H=h($H);}return
adminer()->selectVal($H,$z,$l,$X);}function
is_mail($Lb){$pa='[-a-z0-9!#$%&\'*+/=?^_`{|}~]';$Bb='[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])';$Le="$pa+(\\.$pa+)*@($Bb?\\.)+$Bb";return
is_string($Lb)&&preg_match("(^$Le(,\\s*$Le)*\$)i",$Lb);}function
is_url($Q){$Bb='[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])';return
preg_match("~^(https?)://($Bb?\\.)+$Bb(:\\d+)?(/.*)?(\\?.*)?(#.*)?\$~i",$Q);}function
is_shortable(array$l){return
preg_match('~char|text|json|lob|geometry|point|linestring|polygon|string|bytea~',$l["type"]);}function
count_rows($R,array$Z,$qd,array$Dc){$F=" FROM ".table($R).($Z?" WHERE ".implode(" AND ",$Z):"");return($qd&&(JUSH=="sql"||count($Dc)==1)?"SELECT COUNT(DISTINCT ".implode(", ",$Dc).")$F":"SELECT COUNT(*)".($qd?" FROM (SELECT 1$F GROUP BY ".implode(", ",$Dc).") x":$F));}function
slow_query($F){$i=adminer()->database();$jg=adminer()->queryTimeout();$Jf=driver()->slowQuery($F,$jg);$h=null;if(!$Jf&&support("kill")){$h=connect(adminer()->credentials());if($h&&($i==""||$h->select_db($i))){$xd=get_val(connection_id(),0,$h);echo
script("const timeout = setTimeout(() => { ajax('".js_escape(ME)."script=kill', function () {}, 'kill=$xd&token=".get_token()."'); }, 1000 * $jg);");}}ob_flush();flush();$H=@get_key_vals(($Jf?:$F),$h,false);if($h){echo
script("clearTimeout(timeout);");ob_flush();flush();}return$H;}function
get_token(){$df=rand(1,1e6);return($df^$_SESSION["token"]).":$df";}function
verify_token(){list($qg,$df)=explode(":",$_POST["token"]);return($df^$_SESSION["token"])==$qg;}function
lzw_decompress($Ca){$zb=256;$Da=8;$Sa=array();$mf=0;$nf=0;for($r=0;$r<strlen($Ca);$r++){$mf=($mf<<8)+ord($Ca[$r]);$nf+=8;if($nf>=$Da){$nf-=$Da;$Sa[]=$mf>>$nf;$mf&=(1<<$nf)-1;$zb++;if($zb>>$Da)$Da++;}}$yb=range("\0","\xFF");$H="";$ah="";foreach($Sa
as$r=>$Ra){$Kb=$yb[$Ra];if(!isset($Kb))$Kb=$ah.$ah[0];$H
.=$Kb;if($r)$yb[]=$ah.$Kb[0];$ah=$Kb;}return$H;}function
script($Lf,$rg="\n"){return"<script".nonce().">$Lf</script>$rg";}function
script_src($Mg){return"<script src='".h($Mg)."'".nonce()."></script>\n";}function
nonce(){return' nonce="'.get_nonce().'"';}function
input_hidden($B,$Y=""){return"<input type='hidden' name='".h($B)."' value='".h($Y)."'>\n";}function
input_token(){return
input_hidden("token",get_token());}function
target_blank(){return' target="_blank" rel="noreferrer noopener"';}function
h($Q){return
str_replace("\0","&#0;",htmlspecialchars($Q,ENT_QUOTES,'utf-8'));}function
nl_br($Q){return
str_replace("\n","<br>",$Q);}function
checkbox($B,$Y,$Na,$yd="",$qe="",$Qa="",$zd=""){$H="<input type='checkbox' name='$B' value='".h($Y)."'".($Na?" checked":"").($zd?" aria-labelledby='$zd'":"").">".($qe?script("qsl('input').onclick = function () { $qe };",""):"");return($yd!=""||$Qa?"<label".($Qa?" class='$Qa'":"").">$H".h($yd)."</label>":$H);}function
optionlist($ve,$xf=null,$Pg=false){$H="";foreach($ve
as$ud=>$W){$we=array($ud=>$W);if(is_array($W)){$H
.='<optgroup label="'.h($ud).'">';$we=$W;}foreach($we
as$w=>$X)$H
.='<option'.($Pg||is_string($w)?' value="'.h($w).'"':'').($xf!==null&&($Pg||is_string($w)?(string)$w:$X)===$xf?' selected':'').'>'.h($X);if(is_array($W))$H
.='</optgroup>';}return$H;}function
html_select($B,array$ve,$Y="",$pe="",$zd=""){return"<select name='".h($B)."'".($zd?" aria-labelledby='$zd'":"").">".optionlist($ve,$Y)."</select>".($pe?script("qsl('select').onchange = function () { $pe };",""):"");}function
html_radios($B,array$ve,$Y=""){$H="";foreach($ve
as$w=>$X)$H
.="<label><input type='radio' name='".h($B)."' value='".h($w)."'".($w==$Y?" checked":"").">".h($X)."</label>";return$H;}function
confirm($Td="",$yf="qsl('input')"){return
script("$yf.onclick = () => confirm('".($Td?js_escape($Td):lang(6))."');","");}function
print_fieldset($s,$Cd,$Wg=false){echo"<fieldset><legend>","<a href='#fieldset-$s'>$Cd</a>",script("qsl('a').onclick = partial(toggle, 'fieldset-$s');",""),"</legend>","<div id='fieldset-$s'".($Wg?"":" class='hidden'").">\n";}function
bold($Ea,$Qa=""){return($Ea?" class='active $Qa'":($Qa?" class='$Qa'":""));}function
js_escape($Q){return
addcslashes($Q,"\r\n'\\/");}function
pagination($C,$ob){return" ".($C==$ob?$C+1:'<a href="'.h(remove_from_uri("page").($C?"&page=$C".($_GET["next"]?"&next=".urlencode($_GET["next"]):""):"")).'">'.($C+1)."</a>");}function
hidden_fields(array$Xe,array$ad=array(),$Te=''){$H=false;foreach($Xe
as$w=>$X){if(!in_array($w,$ad)){if(is_array($X))hidden_fields($X,array(),$w);else{$H=true;echo
input_hidden(($Te?$Te."[$w]":$w),$X);}}}return$H;}function
hidden_fields_get(){echo(sid()?input_hidden(session_name(),session_id()):''),(SERVER!==null?input_hidden(DRIVER,SERVER):""),input_hidden("username",$_GET["username"]);}function
enum_input($U,$ra,array$l,$Y,$Ob=null){preg_match_all("~'((?:[^']|'')*)'~",$l["length"],$A);$H=($Ob!==null?"<label><input type='$U'$ra value='$Ob'".((is_array($Y)?in_array($Ob,$Y):$Y===$Ob)?" checked":"")."><i>".lang(7)."</i></label>":"");foreach($A[1]as$r=>$X){$X=stripcslashes(str_replace("''","'",$X));$Na=(is_array($Y)?in_array($X,$Y):$Y===$X);$H
.=" <label><input type='$U'$ra value='".h($X)."'".($Na?' checked':'').'>'.h(adminer()->editVal($X,$l)).'</label>';}return$H;}function
input(array$l,$Y,$q,$va=false){$B=h(bracket_escape($l["field"]));echo"<td class='function'>";if(is_array($Y)&&!$q){$Y=json_encode($Y,128|64|256);$q="json";}$lf=(JUSH=="mssql"&&$l["auto_increment"]);if($lf&&!$_POST["save"])$q=null;$Ac=(isset($_GET["select"])||$lf?array("orig"=>lang(8)):array())+adminer()->editFunctions($l);$_b=stripos($l["default"],"GENERATED ALWAYS AS ")===0?" disabled=''":"";$ra=" name='fields[$B]'$_b".($va?" autofocus":"");$Sb=driver()->enumLength($l);if($Sb){$l["type"]="enum";$l["length"]=$Sb;}echo
driver()->unconvertFunction($l)." ";$R=$_GET["edit"]?:$_GET["select"];if($l["type"]=="enum")echo
h($Ac[""])."<td>".adminer()->editInput($R,$l,$ra,$Y);else{$Kc=(in_array($q,$Ac)||isset($Ac[$q]));echo(count($Ac)>1?"<select name='function[$B]'$_b>".optionlist($Ac,$q===null||$Kc?$q:"")."</select>".on_help("event.target.value.replace(/^SQL\$/, '')",1).script("qsl('select').onchange = functionChange;",""):h(reset($Ac))).'<td>';$jd=adminer()->editInput($R,$l,$ra,$Y);if($jd!="")echo$jd;elseif(preg_match('~bool~',$l["type"]))echo"<input type='hidden'$ra value='0'>"."<input type='checkbox'".(preg_match('~^(1|t|true|y|yes|on)$~i',$Y)?" checked='checked'":"")."$ra value='1'>";elseif($l["type"]=="set"){preg_match_all("~'((?:[^']|'')*)'~",$l["length"],$A);foreach($A[1]as$r=>$X){$X=stripcslashes(str_replace("''","'",$X));$Na=in_array($X,explode(",",$Y),true);echo" <label><input type='checkbox' name='fields[$B][$r]' value='".h($X)."'".($Na?' checked':'').">".h(adminer()->editVal($X,$l)).'</label>';}}elseif(preg_match('~blob|bytea|raw|file~',$l["type"])&&ini_bool("file_uploads"))echo"<input type='file' name='fields-$B'>";elseif($q=="json"||preg_match('~^jsonb?$~',$l["type"]))echo"<textarea$ra cols='50' rows='12' class='jush-js'>".h($Y).'</textarea>';elseif(($eg=preg_match('~text|lob|memo~i',$l["type"]))||preg_match("~\n~",$Y)){if($eg&&JUSH!="sqlite")$ra
.=" cols='50' rows='12'";else{$J=min(12,substr_count($Y,"\n")+1);$ra
.=" cols='30' rows='$J'";}echo"<textarea$ra>".h($Y).'</textarea>';}else{$Bg=driver()->types();$Rd=(!preg_match('~int~',$l["type"])&&preg_match('~^(\d+)(,(\d+))?$~',$l["length"],$_)?((preg_match("~binary~",$l["type"])?2:1)*$_[1]+($_[3]?1:0)+($_[2]&&!$l["unsigned"]?1:0)):($Bg[$l["type"]]?$Bg[$l["type"]]+($l["unsigned"]?0:1):0));if(JUSH=='sql'&&min_version(5.6)&&preg_match('~time~',$l["type"]))$Rd+=7;echo"<input".((!$Kc||$q==="")&&preg_match('~(?<!o)int(?!er)~',$l["type"])&&!preg_match('~\[\]~',$l["full_type"])?" type='number'":"")." value='".h($Y)."'".($Rd?" data-maxlength='$Rd'":"").(preg_match('~char|binary~',$l["type"])&&$Rd>20?" size='".($Rd>99?60:40)."'":"")."$ra>";}echo
adminer()->editHint($R,$l,$Y);$mc=0;foreach($Ac
as$w=>$X){if($w===""||!$X)break;$mc++;}if($mc&&count($Ac)>1)echo
script("qsl('td').oninput = partial(skipOriginal, $mc);");}}function
process_input(array$l){if(stripos($l["default"],"GENERATED ALWAYS AS ")===0)return;$t=bracket_escape($l["field"]);$q=idx($_POST["function"],$t);$Y=$_POST["fields"][$t];if($l["type"]=="enum"||driver()->enumLength($l)){if($Y==-1)return
false;if($Y=="")return"NULL";}if($l["auto_increment"]&&$Y=="")return
null;if($q=="orig")return(preg_match('~^CURRENT_TIMESTAMP~i',$l["on_update"])?idf_escape($l["field"]):false);if($q=="NULL")return"NULL";if($l["type"]=="set")$Y=implode(",",(array)$Y);if($q=="json"){$q="";$Y=json_decode($Y,true);if(!is_array($Y))return
false;return$Y;}if(preg_match('~blob|bytea|raw|file~',$l["type"])&&ini_bool("file_uploads")){$jc=get_file("fields-$t");if(!is_string($jc))return
false;return
driver()->quoteBinary($jc);}return
adminer()->processInput($l,$Y,$q);}function
search_tables(){$_GET["where"][0]["val"]=$_POST["query"];$_f="<ul>\n";foreach(table_status('',true)as$R=>$S){$B=adminer()->tableName($S);if(isset($S["Engine"])&&$B!=""&&(!$_POST["tables"]||in_array($R,$_POST["tables"]))){$G=connection()->query("SELECT".limit("1 FROM ".table($R)," WHERE ".implode(" AND ",adminer()->selectSearchProcess(fields($R),array())),1));if(!$G||$G->fetch_row()){$Ve="<a href='".h(ME."select=".urlencode($R)."&where[0][op]=".urlencode($_GET["where"][0]["op"])."&where[0][val]=".urlencode($_GET["where"][0]["val"]))."'>$B</a>";echo"$_f<li>".($G?$Ve:"<p class='error'>$Ve: ".error())."\n";$_f="";}}}echo($_f?"<p class='message'>".lang(9):"</ul>")."\n";}function
on_help($Xa,$If=0){return
script("mixin(qsl('select, input'), {onmouseover: function (event) { helpMouseover.call(this, event, $Xa, $If) }, onmouseout: helpMouseout});","");}function
edit_form($R,array$m,$I,$Kg,$k=''){$ag=adminer()->tableName(table_status1($R,true));page_header(($Kg?lang(10):lang(11)),$k,array("select"=>array($R,$ag)),$ag);adminer()->editRowPrint($R,$m,$I,$Kg);if($I===false){echo"<p class='error'>".lang(12)."\n";return;}echo"<form action='' method='post' enctype='multipart/form-data' id='form'>\n";if(!$m)echo"<p class='error'>".lang(13)."\n";else{echo"<table class='layout'>".script("qsl('table').onkeydown = editingKeydown;");$va=!$_POST;foreach($m
as$B=>$l){echo"<tr><th>".adminer()->fieldName($l);$j=idx($_GET["set"],bracket_escape($B));if($j===null){$j=$l["default"];if($l["type"]=="bit"&&preg_match("~^b'([01]*)'\$~",$j,$hf))$j=$hf[1];if(JUSH=="sql"&&preg_match('~binary~',$l["type"]))$j=bin2hex($j);}$Y=($I!==null?($I[$B]!=""&&JUSH=="sql"&&preg_match("~enum|set~",$l["type"])&&is_array($I[$B])?implode(",",$I[$B]):(is_bool($I[$B])?+$I[$B]:$I[$B])):(!$Kg&&$l["auto_increment"]?"":(isset($_GET["select"])?false:$j)));if(!$_POST["save"]&&is_string($Y))$Y=adminer()->editVal($Y,$l);$q=($_POST["save"]?idx($_POST["function"],$B,""):($Kg&&preg_match('~^CURRENT_TIMESTAMP~i',$l["on_update"])?"now":($Y===false?null:($Y!==null?'':'NULL'))));if(!$_POST&&!$Kg&&$Y==$l["default"]&&preg_match('~^[\w.]+\(~',$Y))$q="SQL";if(preg_match("~time~",$l["type"])&&preg_match('~^CURRENT_TIMESTAMP~i',$Y)){$Y="";$q="now";}if($l["type"]=="uuid"&&$Y=="uuid()"){$Y="";$q="uuid";}if($va!==false)$va=($l["auto_increment"]||$q=="now"||$q=="uuid"?null:true);input($l,$Y,$q,$va);if($va)$va=false;echo"\n";}if(!support("table")&&!fields($R))echo"<tr>"."<th><input name='field_keys[]'>".script("qsl('input').oninput = fieldChange;")."<td class='function'>".html_select("field_funs[]",adminer()->editFunctions(array("null"=>isset($_GET["select"]))))."<td><input name='field_vals[]'>"."\n";echo"</table>\n";}echo"<p>\n";if($m){echo"<input type='submit' value='".lang(14)."'>\n";if(!isset($_GET["select"]))echo"<input type='submit' name='insert' value='".($Kg?lang(15):lang(16))."' title='Ctrl+Shift+Enter'>\n",($Kg?script("qsl('input').onclick = function () { return !ajaxForm(this.form, '".lang(17)."â€¦', this); };"):"");}echo($Kg?"<input type='submit' name='delete' value='".lang(18)."'>".confirm()."\n":"");if(isset($_GET["select"]))hidden_fields(array("check"=>(array)$_POST["check"],"clone"=>$_POST["clone"],"all"=>$_POST["all"]));echo
input_hidden("referer",(isset($_POST["referer"])?$_POST["referer"]:$_SERVER["HTTP_REFERER"])),input_hidden("save",1),input_token(),"</form>\n";}function
shorten_utf8($Q,$x=80,$Vf=""){if(!preg_match("(^(".repeat_pattern("[\t\r\n -\x{10FFFF}]",$x).")($)?)u",$Q,$_))preg_match("(^(".repeat_pattern("[\t\r\n -~]",$x).")($)?)",$Q,$_);return
h($_[1]).$Vf.(isset($_[2])?"":"<i>â€¦</i>");}function
icon($Wc,$B,$Vc,$lg){return"<button type='submit' name='$B' title='".h($lg)."' class='icon icon-$Wc'><span>$Vc</span></button>";}if(isset($_GET["file"])){if(substr(VERSION,-4)!='-dev'){if($_SERVER["HTTP_IF_MODIFIED_SINCE"]){header("HTTP/1.1 304 Not Modified");exit;}header("Expires: ".gmdate("D, d M Y H:i:s",time()+365*24*60*60)." GMT");header("Last-Modified: ".gmdate("D, d M Y H:i:s")." GMT");header("Cache-Control: immutable");}if($_GET["file"]=="favicon.ico"){header("Content-Type: image/x-icon");echo
lzw_decompress("\0\0\0` \0„\0\n @\0´C„è\"\0`EãQ¸àÿ‡?ÀtvM'”JdÁd\\Œb0\0Ä\"™ÀfÓˆ¤îs5›ÏçÑAXPaJ“0„¥‘8„#RŠT©‘z`ˆ#.©ÇcíXÃşÈ€?À-\0¡Im? .«M¶€\0È¯(Ì‰ıÀ/(%Œ\0");}elseif($_GET["file"]=="default.css"){header("Content-Type: text/css; charset=utf-8");echo
lzw_decompress("h:M‡±h´ÄgÌĞ±ÜÍŒ\"C³éˆŞd<Ìfóa¼ä:;NBˆqœR;1Lf³9ÈŞu7\$)\$L;3ÍÇAĞä`%ŒEÃ!¨€¬e9&ã°‚r4˜M‚ÂA”Øv2\r&:iÎ–sœé“0ìÛ\"3šMÃ¡…šÔ-;šL‡C@èÌi:cs³,î(aG#Ã£°êe§‹ÉË9kS¡Ñºuˆ>˜d“àÊdÀÇcôÃ±æş:6Zc£A¾°rfÙÌôË[¯ĞàÎYüN/d9I†8å©7f\"ìV3Y®¤ù»ü‡)–äßÅÆ£©ÌĞ-4UıÄoD:µxjH¡ b{œÎì&“Ñ”t1ÏìÖ‹U°v8# Èµ!pp2¡\0c%óŒƒ\rã è7¯¸à<š8¹s§	Òò;Œ£HÎ€2¨òÎ6o3†ñŠP•%‰sŠ„Œ±ËÚ>æú¾ïÈJıKJÖ@dBá\0Z‡»ÿ\0ÀctÁ0XÛ©*D!	B´1\r5# @¤i*NøÄq,N2Ã”W¥ij^˜¡0Ê>œzùD‘4Q8Îsd~û!›ô³È¯ìµ\$É(¢s9tdŒÿ£¤Ì:,(Ê=®+šê¢R,ş­´Í:6Sõ:×GÉrl¶ĞÌì€ŸHh´º9,0\0Ç?ÕÔP®“!\$2•UO”Õš4v½#ğôAiWƒ˜è<ÕÔÈ¹\"–réhÁÒõˆºÙm“-°`(p@@pe]L\\iLëOrÄ:aj¥-u`ÌöS/={:É­vÒ¶5´Ğ›ÇT®ƒ,\\x3­cúÅRß+WŒ°fSc%Ÿ˜c–…õÎéG=RCJ¬2,C ÷c€Ø0/@Üä1\rz´®\r˜SX¶M*À¹nW,H”¼\rye—•g.8Ö5¿3ZÁÊ(8R¯â×¯Á5ÙH£HÚ3zr¶©jX t6®C%Y²)ÄÍ»o8ğ¸.V,—&ßğĞIçeˆ²1#íº‘f\\Ê.<ó'?|Æ“´oGCê6ÇOëÍmDT’İ¬XÁ”¥›õWíÿµ·{mWì[¥4\rïTù#-šß\$X×bûöª\n†¢©Ö_3k¶îæİMø™M	ª“¾hA×Óú&¤0ˆêW¾]›ïR¢‹Pà:{ôLqjÙ`-„ ä[¨noô±*ÀÆĞ›ÓPo­QÀ '`X[[aÀ2ƒĞDdPoAu¼”†ßùk`\$Y0%¸0ÿqÁ„:†Æ…\0‹h@!¼;¬eÖ‚’j0FP¼:ãvC¨i7lÉıC«²ù\rğHy—RM‰oæC\0îÒyl\$ò\$äû/µ©ÔÈÿÀ.0¡¼•´38ûÚLs~aôó:NÊÕF İú;#è}°2Hqğ55æ	}€¸ËHÕç#IĞl#/¹£´“±d°.<ÁÔ6†æ˜€:Är8'FpêÙã·^\0È¯\$†£bk¥½‹ ZPå¬.’ğÈ‡A\$Ì°w˜¬Õf†I‡2ƒpÂgÌUA\$R½%GÙæ‘@]4&2ššæzm2\$RœŠ”Ş)¸9Huİãã!!™Ö‚éÖG\0bZ/‰œ“4ÒM“Z>P)¾s§8øC(s+ÁO­@tKQÈn•ÎõYé7¨E\n41*º`ˆûåMTNyR*:ƒ”ì’tf…©ùdÊ[^Í¸û¯&ä±æğc‡S¶‡`\rÂ1…(ÅNäaPiøFAºRTb%P*ŞE¨‘šãáhqÍ:@èhË¡z’°2€dLû_sô„`k[«tŞ”4èÇ†º<¼ë¡+3óíÈéDxI]w¯õÖ½ºŠ×,\"{9Ús:UÊD…PàèŸ¨ø‰„“\"R\"‘\$ê!Y±‡HßA2ÖT|Şƒj}s¤7ƒxpb:˜÷ú­³5¡ZÔ—kãá³¡İØ–¶·KÃsx•¢±qh(\"Õ’o0âÑÍÙ€µ äH°]uš‰9B'EW%ô&…A•1Aá÷–ª:§§Ùh³lMØøVä­J	IÊPKöäg‹9/T€Ê†Jáùm‚0¡©–¸*à£ø\rÈe\0Ji8ü\$üŞÂNšvà‹€Ï=X»òP8Òë-`@.<!±¶0êÓ<Szñ2INÃãbŞiìQÂÓıymB(­ËÙ{MÛ8 H¡ˆb\\‚i3çÉ@€3Ï@×˜7\$ğ»Q³ìÓ	-%¨Ÿ°Q’ònOLäĞ‚å å•2¶X(`¤eL\nPR¥n€»¹ğ|v­R½<gbOKÈB³^mkûÇ›Ë»?h/	#dkb¦qÈ\rr:íM€Ë9O´É˜²ì7Ü‚å£D|#¡œ—´+Ë/oS\rÇRU˜cbt¹mÔú` ²ò›p-Œ”Ö:S1¼kÖŠ7ëuî©’‘Èè3a–ÛôYvÆ/¡ÕäÀGªËPsÛÊqO6•‚XATÍá¬Ê¯!eçlÈm´=ìE6øoHÒ8Ôî:=¿Lc3Êãê/¾&Ìg@9b;d‚/»ãpíÄ÷\"¬ÜÁßOjS8ßáÑ_ˆ˜ê\$wÎû7ŒoşW¿·.)zŠOçÌMùA{1DïJĞdñRRZjëh!ŠoMÕNß)mãYl¨Û³%f·—¹m©E‰âíİÁz¥³±Ã­±/±Ù¢ÉÔRvy@b»!1‡+;|tıóœÚŠhÆgÓök\0× ïaƒ.…‡ò:¿¨£Ÿ¥¶˜xr((MsDÍÖ–ŞZÇI×ÿ|ê ÍéŒ¦8êÊœ2­x)èS†¦åòˆı'uXaÎº~{©v66T›¶sŒAİKÖÖös\\(b\reàû¥²U­·¾ß°ğ–uçÆTúØŞi•†› É|jJJX»7²V;·N•]C[WëC\nó7sĞİ†æE¹½¦9Ö²·”b¶Ùüv_yÁM6šH­‡~ñ jJE†g\0“Fş{Nä1\0ô¢Ô1Àğ>ì4/oŠm\0,êL^\r€P¨ƒ4ËªâÒ,¢R,@l€X\n@`\r€	àˆ\r€Ğ Î ¦ ’ ‚	 Êàêğj Î	@Ú@Ú\n ƒ	 †	\0j@ƒP“@™	0©À‚@“	 ¢	\$N	 V\0ò``\n\0¨\n Ğ\n@¨% ìÀ¤\n\0`\rÀÚ ¬	à’\rà¤ ´\0ĞR°vÀò	\0„`‚	àî z}\0\\ÂO6‡‰Mğ2ËĞ88ğ>2PC@Ë‚ÈFpQPYĞaPi\nĞsp{ğƒp‹ğ©	p›	ğ©\nP«	0oµ€ÑĞÁPÈ\n Ô\0ôkbÈl\0^“@Ò\0`àÚ@´àÈ\"\nĞÿ1±0&'@ZhÃºæ‡Ç07±*SƒÑ5ÀÃ°W°_0g°o°yĞ	1UĞ‘	P™	Ğ¡§qk ƒ`Ñ0¿0Ç±1†\r ^Àä\"Y	`\nÀ Œ5 ˜\0ê	 p\n€ò\n€š`Œ ˆq´¾ğ(í¦ÜÑ!CíAì½18°S±AGpu±Q‰Q[±a\n ƒ 0« qn\rRpÆ	 ï@b\r`µ\r`Ü\rÀˆ	€ŞÀÌ€dàª€¨	,\n®Ü``À†\n€œ`d÷ÑQûï¢ŸŒ?&Q'Òk&RqòuÑİ1ã\nÀ•\n\0ŸĞ‚2‹‘ùñÿR\nò	\0Í*0Â`ìğÀ\n `\n@êàfd\0° ª`Æ ’\nà¦@´	€âDÃ¸`p€í  ‚ËO–ıæ\$B\\¸'‚„(„òÿ±/&ğK'2wñß@‡	 —¨	3ªà ó½3)2—s° ß; ¡\0”hÀäà˜@¢\n@â€ fÆ“%1,ÔÀÊƒƒ\$ÉG*}fF²(ø@è\r€@\rxò\$J.Œr÷AšHA+ŞU‰'B…æãaBôÊXËÏ^¦¤ÑL‰@ô0Ó-ôÕ¨Æëü×hhBi½C€FçFGD¯\nüè†eŠRÕ4@C®ÔfÚíí‡F`ŞmwG¯ ¦„‘Aí¢U4ŠÄ\0¡ÍIgùI´èTUAKx›èÀŒT¹FvŒÂ\$YTŠéD­Ct0ÛM‘Lô¼r­1C‡›N}ˆì7k42ˆld ú\n@oÒ*T)dÌq…D@p ­4°ËÔ·F˜›ÍWEÏèIzë­ğìKQõ39Mÿh~É*L!çÑFäEG+ÊØnŠâ–Ù)R[C„ô GHäI ÚŸM†” ®JüÆ®È”‘‰NNÂƒŒ,îÌ@Öü)Rşn¤ÒàfJOcM‰*¯Õ6‰\ré-Y•lÇ5piôkEt²¡ ÷FT»]4UÂøçŒNÕgL4Œíu|ŸUİF€ûPu\n*'*yMÀÎÛÕDÂé<àîsUõèØ5dÛ5xíİWô^`ôL›Îèœ&dš©¢™…5cÆØã‰Éj\n5ş");}elseif($_GET["file"]=="dark.css"){header("Content-Type: text/css; charset=utf-8");echo
lzw_decompress("h:M‡±h´ÄgÆÈh0ÁLĞàd91¢Ó	ìÆo6ÎP‘¨Änf0qÁÑØÒs4¦Hô‚E\$“J%RÃa¤Ük\rçc)ÈXa–Ëæ3:\r‹5ÈÄqƒÀÊ1•š'³ˆÉEÇê2C(ähc¬X¦â31˜Èd1‡f#	ŒÖg9Î¦ã\$\$b5†ÃšÈÊ¹^°ZªF™ŠŞ3â¡0¸…Òíx½_!#3Øn82JÎ†°Ê,:5Œ9Ê¾r°ÍªUa Äm¡>5™k½æ÷}ŒF#1ÀÔÃ¢4L&A§WÊænª¹LhkrŞf7ù>f5ät9¦w\$#êŒ:ò³1¤Êl2Ì§Mn¿ccà°9ö>¯«‹«zÌ¸ˆã4JèÈ<¹©„¢NkT:AP`é)Ğ‹¤ì·ÌÓ‚»á« >Ê\rC¨æİÀNÔ=8¯ê|8£ \\¯¥¨Øú+£À[¹cxî#€ğH²<’\"¡ÂwÆ¡tL8£LLÕJ°Ú0\r0Ü3Ãc|} ’‰#ID—+¥at ˜\rãs¦©IÉÜP9„rÄ:³”9;‹¼ğ¡rŠ¼S˜u6OîØF2­Î[®µÊ,Ï#i\0ÒæQá¸l3Sóm‘ËÃ® å9ShÚ2c˜Â3Œ´R1°`1.qmR„Õk›‘ÉtÊ{N\$ìrO6Œc@ÃD¼ã\nÌÚShÈ0¦U°j­İD7O•°È†£Ë6ŒIõ<ÖÊ¢¬¬P£zß<B—”,‘ÍÒÂ4\r/€P\rÁMOÑÁƒÀ^¼ófŒ«³HÓanJì™ÂAf=bC^2â8h×ŠCuõ\0à†˜ss¼ìğÂ4&/†aÍ.9ŒcÊd¢â¹~3ã¸šû›ÃQeQ‘¸qGcÙæiŸ<µ¶U–eÃJ?9=±İ,ŸB P…5î†ß¾ëX`0LÛ©N*l!ÅÃ&Â©Ì2¥a_p>¬Kd„±Œs½ºîã¨@8B3§ÃŸ\nÑæCòØ<á›1[›¨Å9cå>TÔl^À0L ú«U²Ú·®;¬Ş4Î7d1dÁ¾ê9á’ÜóÆ4Ü~ŞÉ‡!˜iotnHØ8wYHlkØ\$<1†ã(h3nhäöÃ Ò;İÆ8óoa8£1ì2ÜÊê:zõ¯\"‡Aº¦iˆZö½ï‹›\nÁ»VpçQş°èüÏqğ^á¿¦‚ÛûŞJ|›€");}elseif($_GET["file"]=="functions.js"){header("Content-Type: text/javascript; charset=utf-8");echo
lzw_decompress("':œÌ¢™Ğäi1ã³1Ôİ	4›ÍÀ£‰ÌQ6a&ó°Ç:OAIìäe:NFáD|İ!‘Ÿ†CyŒêm2ËÅ\"ã‰ÔÊr<”Ì±˜ÙÊ/C#‚‘Ùö:DbqSe‰JË¦CÜº\n\n¡œÇ±S\rZ“H\$RAÜS+XKvtdÜg:£í6Ÿ‰EvXÅ³j‘ÉmÒ©ej×2šM§©äúB«Ç&Ê®‹L§C°3„åQ0ÕLÆé-xè\nÓìD‘ÈÂyNaäPn:ç›¼äèsœÍƒ( cLÅÜ/õ£(Æ5{ŞôQy4œøg-–‚ı¢êi4ÚƒfĞÎ(ÕëbUıÏk·îo7Ü&ãºÃ¤ô*ACb’¾¢Ø`.‡­ŠÛ\rÎĞÜü»ÏÄú¼Í\n ©ChÒ<\r)`èØ¥`æ7¥CÊ’ŒÈâZùµãXÊ<QÅ1X÷¼‰@·0dp9EQüf¾°ÓFØ\r‰ä!ƒæ‹(hô£)‰Ã\np'#ÄŒ¤£HÌ(i*†r¸æ&<#¢æ7KÈÈ~Œ# È‡A:N6ã°Ê‹©lÕ,§\r”ôJPÎ3£!@Ò2>Cr¾¡¬h°N„á]¦(a0M3Í2”×6…ÔUæ„ãE2'!<·Â#3R<ğÛãXÒæÔCHÎ7ƒ#nä+±€a\$!èÜ2àPˆ0¤.°wd¡r:Yö¨éE²æ…!]„<¹šjâ¥ó@ß\\×pl§_\rÁZ¸€Ò“¬TÍ©ZÉsò3\"²~9À©³jã‰PØ)Q“Ybİ•DëYc¿`ˆzácµÑ¨ÌÛ'ë#t“BOh¢*2ÿ…<Å’Oêfg-Z£œˆÕ# è8aĞ^ú+r2b‰ø\\á~0©áş“¥ùàW©¸ÁŞnœÙp!#•`åëZö¸6¶12×Ã@é²kyÈÆ9\rìäB3çƒpŞ…î6°è<£!pïG¯9àn‘o›6s¿ğ#FØ3íÙàbA¨Ê6ñ9¦ıÀZ£#ÂŞ6ûÊ%?‡s¨È\"ÏÉ|Ø‚§)şbœJc\r»Œ½NŞsÉÛih8Ï‡¹æİŸè:Š;èúHåŞŒõu‹I5û@è1îªAèPaH^\$H×vãÖ@Ã›L~—¨ùb9'§ø¿±S?PĞ-¯˜ò˜0Cğ\nRòmÌ4‡ŞÓÈ“:ÀõÜÔ¸ï2òÌ4œµh(k\njIŠÈ6\"˜EYˆ#¹W’rª\r‘G8£@tĞáXÔ“âÌBS\nc0Ék‚C I\rÊ°<u`A!ó)ĞÔ2”ÖC¢\0=‡¾ æáäPˆ1‘Ó¢K!¹!†åŸpÄIsÑ,6âdÃéÉi1+°ÈâÔk‰€ê<•¸^	á\nÉ20´FÔ‰_\$ë)f\0 ¤C8E^¬Ä/3W!×)Œu™*äÔè&\$ê”2Y\n©]’„EkñDV¨\$ïJ²’‡xTse!RY» R™ƒ`=Lò¸ãàŞ«\nl_.!²V!Â\r\nHĞk²\$×`{1	|± °i<jRrPTG|‚w©4b´\r‰¡Ç4d¤,§E¡È6©äÏ<Ãh[N†q@Oi×>'Ñ©\rŠ¥ó—;¦]#“æ}Ğ0»ASIšJdÑA/QÁ´â¸µÂ@t\r¥UG‚Ä_G<éÍ<y-IÉzò„¤Ğ\" PÂàB\0ıíÀÈÁœq`‘ïvAƒˆaÌ¡Jå RäÊ®)Œ…JB.¦TÜñL¡îy¢÷ Cpp\0(7†cYY•a¨M€é1•em4Óc¢¸r£«S)oñÍà‚pæC!I†¼¾SÂœb0mìñ(d“EHœøš¸ß³„X‹ª£/¬•™P©èøyÆXé85ÈÒ\$+—Ö–»²gdè€öÎÎyİÜÏ³J×Øë ¢lE“¢urÌ,dCX}e¬ìÅ¥õ«mƒ]ˆĞ2 Ì½È(-z¦‚Zåú;Iöî¼\\Š) ,\n¤>ò)·¤æ\rVS\njx*w`â´·SFiÌÓd¯¼,»áĞZÂJFM}ĞŠ À†\\Z¾Pìİ`¹zØZûE]íd¤”ÉŸOëcmÔ]À ¬Á™•‚ƒ%ş\"w4Œ¥\n\$øÉzV¢SQDÛ:İ6«äG‹wMÔîS0B‰-sÆê)ã¾Zí¤cÇ2†˜Î´A;æ¥n©Wz/AÃZh G~cœc%Ë[ÉD£&lFRæ˜77|ªI„¢3¹íg0ÖLƒˆa½äcÃ0RJ‘2ÏÑ%“³ÃFáº SÃ ©L½^‘ trÚîÙtñÃ›¡Ê©;”Ç.å–šÅ”>ù€Ãá[®a‡N»¤Ï^Ã(!g—@1ğğó¢üN·zÔ<béİ–ŒäÛÑõO,ÛóCîuº¸D×tjŞ¹I;)®İ€é\nnäcºáÈ‚íˆW<sµ	Å\0÷hN¼PÓ9ÎØ{ue…¤utëµ•öè°ºó§½ 3ò‡î=ƒg¥ëº¸ÎÓJìÍºòWQ‡0ø•Øw9p-…Àº	ı§”øËğÙ'5»´\nOÛ÷e)MÈ)_kàz\0V´ÖÚúŞ;jîlîÎ\nÀ¦êçxÕPf-ä`CË.@&]#\0Ú¶pğyÍ–Æ›ŒtËdú¶ Ãó¼b}	G1·mßru™ßÀ*ñ_ÀxD²3Çq¼„BÓsQæ÷u€ús%ê\nª5s§ut½„Â{sòy¥€øNŸ¯4¥,J{4@®ş\0»’PÄÊÃ^ºš=“¯l„“²`èe~FÙ¡h3oé\"¤”q·R<iUT°[QàôUˆÇM6üT. ºê0'pe\\¼½ôŞ5ßÖÌ”pCe	Ù•Ô\"* M	”¨¦–D™ş±?ûhüØ2¡ĞãzU@7°CÓ4ıaµ²iE!fË\$üB¤…<œ9o*\$¯ælH™\$ Å@ààÊæ€P\rNÀYn<\$²	ÀQ…=F&¥ *@]\0ÊÏË W'dÖ z\$æĞjĞP[¢ö\$òä¯Ğ0#& _Ì`+†B)„wŒv%	âÔ›LcJ„€RSÀÂi`ÌÅ®	F€W	êË\nBP\nç\r\0}	ï¦®0²Zğ¸‚ò/`j\$«: §8ieüÀØÏ†xâ¹Â±îa ¬GnøsgO¢äU%VU°†@‚NÀ¤Ïúd+®(oJï†@XÆèàzM'FÙ£àWhV®I^Ù¢™1>İ@Ğ\"î¨¤‰ ÈQñR!‘\\¢`[¥¤«¨‰.Ø0fb†F;ëÂ‡çFpÏp/t`Â ô®(§ÀVé¸ø b“È²‰(€ˆHˆl‚œÁÎÔ¯1v­Ş‘€ğHĞï1Tï3ñ“q›àÉ1¦ÑªfË\nT\$°éàNq+Ëí`ŞvÖÇœï\rüVmûÇr°¨Ø'Ï¸±ñg%«\"Lˆm¼…‘(’(CLzˆ\"hâXØm= \\H\n0U‡‚ f&M\$¤g\$ñU`a\rPş>`Ë#gªhôî`†R4H€Ñ'ç©­³²GK;\"M¶Û¨TŒhµBEn\"b> Ú\rÀš©#›\0æ•N:í#_	QQ1{	f:BËÂáRª&àÜã)JµÄBr¹+ÂK.\$ĞPqõ-r®S%TIT&Qö·Ò{#2o(*P¯â5ï`„1H…®¢'	<Tğd±÷ª¾sÀì,NÚÊ ÒÉÔì^\r%ƒ3îĞ\r&à“4Bì/\0ĞkLH\$³4dÓ>ŠàÒ/³à¶µ€Hö€·* ºù3JÇĞ¥<†Hh©pú'‚çO/&ï2I.îx3V.¢s5Óe3íªÛZÛ(õ9E”g§;R—;±J½‘QÃ@ªÓvgz@¶“‚Şó†'dZ&Â,Uã²ßò¦F æb*²D‹òH! ä\r’;%‡x'G#°šÍ w‰Á#°Ö È2;#òBvÀXÉâ”aí\nb”{4K€G¦ß%°†ÒGuE`\\\rB\r\0¨-mW\rM\"¶#EôcFbFÕnzÓóÿ@4JÈÒ[\$Êë%2V”‹%ô&TÔV›ˆdÕ4hemN¯-;EÄ¾%E¥E´r <\"@»FÔPÂ€·L Üß­Ü4EÉğ°ÒÄz`ĞuŒ7éNŠ4¯Ë\0°F:hÎKœh/:\"™MÊZÔö\r+P4\r?¤™Sø™O;B©0\$FCEp‚ÇM\"%H4D´|€LN†FtEÑşgŠş°5å=J\r\"›Ş¼5³õ4à¾KñP\rbZà¨\r\"pEQ'DwKõW0î’g'…l\"hQFïC,ùCcŒ®òIHÒP hF]5µ& fŸTæÌiSTUS¨ÿîÉ[4™[uºNe–\$oüKìÜO àÿb\" 5ï\0›DÅ)EÒ%\"±]Âî/­âÈĞŒJ­6UÂdÿ‡`õña)V-0—DÓ”bMÍ)­šŠïÔ¯ØıÄ`Šæ%ñELtˆ˜+ìÛ6C7jëdµ¤:´V4Æ¡3î -ßR\rGòIT®…#¥<4-CgCP{V…\$'ëˆÓ÷gàûR@ä'Ğ²S=%À½óFñk: ¢k‘Ø9®²¤óe]aO¼ÒG9˜;îù-6Ûâ8WÀ¨*øx\"U‹®YlBïîöò¯ğÖ´°·	§ı\n‚îp®ğÉlšÉìÒZ–m\0ñ5¢òä®ğOqÌ¨ÌÍbÊW1s@ĞùKéº-pîûÆE¦Spw\nGWoQÓqG}vp‹w}q€ñqÓ\\Æ7ÆRZ÷@Ìì¡t‡ıtÆ;pG}w×€/%\"LE\0tÀhâ)§\r€àJÚ\\W@à	ç|D#S³¸ÆƒVÏâR±z‰2Ïõövµú©–‘	ã}¨’‡¢¯(¸\0y<¤X\r×İx±°‹q·<µœIsk1Sñ-Q4Yq8î#Şîv—îĞd.Ö¹S;qË!,'(òƒä<.è±J7Hç\"’š.³·¨ñuŒ°‡ü€#ÊQ\reƒrÀXv[¬h\$â{-éY °ûJBgé‰iM8¸”'Â\nÆ˜tDZ~/‹b‹ÖÕ8¸\$¸¸DbROÂOÆû`O5S>¸ö˜Î[ DÇê”¸¥ä€_3Xø)©À'éÄJd\rX»©¸UDìU X8ò•x¯-æ—…àPÌN` 	à¦\nŠZà‹”@Ra48§Ì:ø©\0éŠx°†ÖN§\\ê0%ãŒ·f“˜\\ ğ>\"@^\0ZxàZŸ\0ZaBr#åXÇğ\r•¨{•àË•¹flFb\0[–Şˆ\0[—6›˜	˜¢° ©=’â\n ¦WBøÆ\$'©kG´(\$yÌe9Ò(8Ù& h®îRÜ”ÙæoØÈ¼ Ç‡øƒ†Y£–4Øô7_’­dùã9'ı‘¢ú Üúï²ûz\r™ÙÖ  Ÿåğşv›G€èO8èØìMOh'æèXöS0³\0\0Ê	¸ı9s?‡öI¹MY¢8Ø 9ğ˜üä£HO“—,4	•xs‘‚P¤*G‡¢çc8·ªQÉ ø˜wB|Àz	@¦	à£9cÉK¤¤QGÄbFjÀXú’oSª\$ˆdFHÄ‚PÃ@Ñ§<å¶´Å,‚}ï®m£–rœÿ\"Å'k‹`Œ¡cà¡x‹¦e»C¨ÑCìì:¼ŞØ:XÌ ¹TŞÂÂ^´dÆÃ†qh¤ÎsÃ¹×LvÊÒ®0\r,4µ\r_vÔLòj¥jMáb[  ğƒlsÀŞ•Z°@øºäÁ¶;f”í`2Ycëeº'ƒMerÊÛF\$È!êê\n ¤	*0\rºAN»LP¥äjÙ“»»¿¼;Æ£VÓQ|(ğ‰3’†ÄÊ[p‰˜8óú¼|Ô^\räBf/DÆØÕÒ Bğ€_¶N5Mô© \$¼\naZĞ¦¶È€~ÀUlï¥eõrÅ§rÒ™Z®aZ³•¹ãøÕ£s8RÀGŒZŒ w®¢ªNœ_Æ±«YÏ£òm­‰âªÀ]’¦;ÆšLÚÿ‚º¶cø™€û°Å°ÆÚIÀQ3¹”Oã‡Ç|’y*`  ê5ÉÚ4ğ;&v8‘#¯Rô8+`XÍbVğ6¸Æ«i•3Fõ×EĞô„Øoc82ÛM­\"¶˜¹©G¦Wb\rOĞC¿VdèÓ­¤w\\äÍ¯*cSiÀQÒ¯“ã³R`úd7}	‚ºš)¢Ï´·,+bd§Û¹½FN£3¾¹L\\ãşeRn\$&\\rôê+dæÕ]O5kq,&\"DCU6j§pçÇÉ\\'‚@oµ~è5N=¨|”&è´!ÏÕBØwˆHÚyyz7Ï·(Çøâ½b5(3Öƒ_\0`zĞb®Ğ£r½‚8	ğ¢ZàvÈ8LË“·)²SİM<²*7\$›º\rRŒb·–âB%ıàÆ´Ds€zÏR>[‚Q½ŒĞ&Q«¨À¯¡Ì'\r‡ppÌz·/<‹‡}L¢#°Î•ÂĞâZ¹ã²\"tÆï\n„.4Şgæ«Pºp®Dìnà¥Ê¹NÈâFàd\0`^—åä\rnÈ‚×³#_âÄ w(ü2÷<7-ªXŞ¹\0··s¬ø,^¹hC,å!:×\rK„Ó.äİÓ¢¯Å¢ï¹ÔØ\\„ò+v˜Zàê\0§Q9eÊ›ËEöw?>°\$}£·D#ªğã cÓ0MV3½%Y»ÛÀ\rûÄtj5ÔÅ7¼ü{ÅšLz=­<ƒë8IøMõ°•õâGØÑÎŞLÅ\$’á2‰€{(ÿpe?uİ,Rïd*Xº4é®ı¿‡Í\0\"@Šˆš}<.@õ’	€ŞN²²\$î«XUjsİ/üî<>\"* è#\$Ôş÷Õ&CPI	ÿèt¿áùü¦î?è †´	ğOËÇ\\ Ì_èÎQ5YH@‹ŠÙbâÑcÑhî·ùæë±––…O0T©' 8¡wü»­öj+H€v_#º„íïì06ÈwÖœX†à»d+£Ü“\\Àå–\n\0	\\ğŸŸ>sî…ÓšA	PFöd8m'@š\nH´\0¬cèOwSßØ’—Yá`²ˆˆ¨¢R×ıDna\" ì™~Â?Ámğ†|@6ä½+ìGxV’ä\0°‰WƒÓ°’nw”„‘.¡Øƒb«Ÿ9Ã¸ˆEÈ|E·ÃÂ\rĞˆr¬\"Ğøx„‘¸-¸êŠâš\rN6n·\$Ò¬ı-BíHæ^Ó)â¥y&ãã×šW–Ç§àbv…Rì	¸¥³N\0°Ànâ	T„–`8X¬ğA\r:{Oş@\" Œ!Á¤\$KÂäqoĞËjYÖªJ´şÂíÜh}d<1IÇxdŠÊÎTT4NeeC0ä¥¿‡:D›FÚ5LŞ*::H”jZå—­FõRªMÖ€nS\n>POó[Œ\$V8;#‰K\\'ùBÖè»R®Ø¯°›RÑ_8Ájé*Ej \\~vÆÂĞvÄÛp@T€X‹\0002dE	…Hí‡Vğñ×D”\"Q'EDJB~A´ƒA¤Il*'\n¶Yå.è›+©9¾ñpg†ƒÒ/\"¸1—8Ä0„IAÊFCÈ¨ŠV*a™èPÀdÖĞ£5H\" AØå6İs¬YİØ;è¨È/¨¸0ãv}y˜\rÍƒâÎ×¥1…u\"Ë‹Šmãñ_º0ç„„`ß¯¿\\B1^\nk\r]lhø}]HBW`±—0½ê¨¹rFf€)”W,ÕÒ§]sm9'O¢xÔ½Í,ê9J8§£? 4ÉÉï¡\"Ò…èÛ½Ì<Ñ-S¨ÉÃşMÃ;ĞvÌñ6y|„ZòÁ‹¨%àa•#8¢ˆTC‘!pºË\nØïCZ(ï½9|Ü¾æª,Ú\nº+Q\$äÅ­ôÈ+İ_+ãÊ\$¸ú%d  eDQ‚JŸØü¥iXˆ}\0P×¾‡²Çü·æ”BPë†¾ÄW?¥úÉè¯Œ‹7áHQ~§üWòşS¾É\n?	Å ç€Êúö>µ!oĞ\0ğR1áÂ9‚c‘x\$bĞ6ŠzB‹ƒ‹”\"ÄY«Ö²‚©ù\$k#w 4„Èr’¿ÆîˆÎ|J y>ãú\$˜¹'İà)æ~8˜ÀÂ„é-¼«ÒD”‡Äu!¥~öCÌ&c–dPú&ö–¡şÈ‚Aîœ<=bnIÿ	\\‰xÑÈX'@ˆ	ùËÛOìƒçSª`XÉ‘[dÓ!ÕŠâ&¹Šèå‡±Aà!I\$'””íUS(&SîÚl¨¼®uk—†GÉ'»¡Rš>WI¡~Òj”Œ™†L¦õ>…ôbË(Ğ™ßé'U²IİÄ’º½¤<òI(¡*Jc¢XBÖ|zGprñÔb+LZ‹U­–fQ±<DáçU\n“Tô\"¥ìñaÃ~SÀ™t¤ÂÙ©E|NRĞ");}elseif($_GET["file"]=="jush.js"){header("Content-Type: text/javascript; charset=utf-8");echo
lzw_decompress('');}exit;}if($_GET["script"]=="version"){$n=get_temp_dir()."/adminer.version";@unlink($n);$p=file_open_lock($n);if($p)file_write_unlock($p,serialize(array("signature"=>$_POST["signature"],"version"=>$_POST["version"])));exit;}if(!$_SERVER["REQUEST_URI"])$_SERVER["REQUEST_URI"]=$_SERVER["ORIG_PATH_INFO"];if(!strpos($_SERVER["REQUEST_URI"],'?')&&$_SERVER["QUERY_STRING"]!="")$_SERVER["REQUEST_URI"].="?$_SERVER[QUERY_STRING]";if($_SERVER["HTTP_X_FORWARDED_PREFIX"])$_SERVER["REQUEST_URI"]=$_SERVER["HTTP_X_FORWARDED_PREFIX"].$_SERVER["REQUEST_URI"];define('Adminer\HTTPS',($_SERVER["HTTPS"]&&strcasecmp($_SERVER["HTTPS"],"off"))||ini_bool("session.cookie_secure"));@ini_set("session.use_trans_sid",'0');if(!defined("SID")){session_cache_limiter("");session_name("adminer_sid");session_set_cookie_params(0,preg_replace('~\?.*~','',$_SERVER["REQUEST_URI"]),"",HTTPS,true);session_start();}remove_slashes(array(&$_GET,&$_POST,&$_COOKIE),$lc);if(function_exists("get_magic_quotes_runtime")&&get_magic_quotes_runtime())set_magic_quotes_runtime(false);@set_time_limit(0);@ini_set("precision",'15');function
langs(){return
array('en'=>'English','ar'=>'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©','bg'=>'Ğ‘ÑŠĞ»Ğ³Ğ°Ñ€ÑĞºĞ¸','bn'=>'à¦¬à¦¾à¦‚à¦²à¦¾','bs'=>'Bosanski','ca'=>'CatalÃ ','cs'=>'ÄŒeÅ¡tina','da'=>'Dansk','de'=>'Deutsch','el'=>'Î•Î»Î»Î·Î½Î¹ÎºÎ¬','es'=>'EspaÃ±ol','et'=>'Eesti','fa'=>'ÙØ§Ø±Ø³ÛŒ','fi'=>'Suomi','fr'=>'FranÃ§ais','gl'=>'Galego','he'=>'×¢×‘×¨×™×ª','hu'=>'Magyar','id'=>'Bahasa Indonesia','it'=>'Italiano','ja'=>'æ—¥æœ¬èª','ka'=>'áƒ¥áƒáƒ áƒ—áƒ£áƒšáƒ˜','ko'=>'í•œêµ­ì–´','lt'=>'LietuviÅ³','lv'=>'LatvieÅ¡u','ms'=>'Bahasa Melayu','nl'=>'Nederlands','no'=>'Norsk','pl'=>'Polski','pt'=>'PortuguÃªs','pt-br'=>'PortuguÃªs (Brazil)','ro'=>'Limba RomÃ¢nÄƒ','ru'=>'Ğ ÑƒÑÑĞºĞ¸Ğ¹','sk'=>'SlovenÄina','sl'=>'Slovenski','sr'=>'Ğ¡Ñ€Ğ¿ÑĞºĞ¸','sv'=>'Svenska','ta'=>'à®¤â€Œà®®à®¿à®´à¯','th'=>'à¸ à¸²à¸©à¸²à¹„à¸—à¸¢','tr'=>'TÃ¼rkÃ§e','uk'=>'Ğ£ĞºÑ€Ğ°Ñ—Ğ½ÑÑŒĞºĞ°','uz'=>'OÊ»zbekcha','vi'=>'Tiáº¿ng Viá»‡t','zh'=>'ç®€ä½“ä¸­æ–‡','zh-tw'=>'ç¹é«”ä¸­æ–‡',);}function
lang($t,$ie=null){if(is_string($t)){$Re=array_search($t,get_translations("en"));if($Re!==false)$t=$Re;}$tg=(Lang::$ug[$t]?:$t);if(is_array($tg)){$Re=($ie==1?0:(LANG=='cs'||LANG=='sk'?($ie&&$ie<5?1:2):(LANG=='fr'?(!$ie?0:1):(LANG=='pl'?($ie%10>1&&$ie%10<5&&$ie/10%10!=1?1:2):(LANG=='sl'?($ie%100==1?0:($ie%100==2?1:($ie%100==3||$ie%100==4?2:3))):(LANG=='lt'?($ie%10==1&&$ie%100!=11?0:($ie%10>1&&$ie/10%10!=1?1:2)):(LANG=='lv'?($ie%10==1&&$ie%100!=11?0:($ie?1:2)):(in_array(LANG,array('bs','ru','sr','uk'))?($ie%10==1&&$ie%100!=11?0:($ie%10>1&&$ie%10<5&&$ie/10%10!=1?1:2)):1))))))));$tg=$tg[$Re];}$tg=str_replace("'",'â€™',$tg);$ma=func_get_args();array_shift($ma);$xc=str_replace("%d","%s",$tg);if($xc!=$tg)$ma[0]=format_number($ie);return
vsprintf($xc,$ma);}function
switch_lang(){echo"<form action='' method='post'>\n<div id='lang'>",lang(19).": ".html_select("lang",langs(),LANG,"this.form.submit();")," <input type='submit' value='".lang(20)."' class='hidden'>\n",input_token(),"</div>\n</form>\n";}if(isset($_POST["lang"])&&verify_token()){cookie("adminer_lang",$_POST["lang"]);$_SESSION["lang"]=$_POST["lang"];redirect(remove_from_uri());}$aa="en";if(idx(langs(),$_COOKIE["adminer_lang"])){cookie("adminer_lang",$_COOKIE["adminer_lang"]);$aa=$_COOKIE["adminer_lang"];}elseif(idx(langs(),$_SESSION["lang"]))$aa=$_SESSION["lang"];else{$da=array();preg_match_all('~([-a-z]+)(;q=([0-9.]+))?~',str_replace("_","-",strtolower($_SERVER["HTTP_ACCEPT_LANGUAGE"])),$A,PREG_SET_ORDER);foreach($A
as$_)$da[$_[1]]=(isset($_[3])?$_[3]:1);arsort($da);foreach($da
as$w=>$Ze){if(idx(langs(),$w)){$aa=$w;break;}$w=preg_replace('~-.*~','',$w);if(!isset($da[$w])&&idx(langs(),$w)){$aa=$w;break;}}}define('Adminer\LANG',$aa);class
Lang{static$ug;}Lang::$ug=$_SESSION["translations"];if($_SESSION["translations_version"]!=LANG.
3825666573){Lang::$ug=array();$_SESSION["translations_version"]=LANG.
3825666573;}if(!Lang::$ug){Lang::$ug=get_translations(LANG);$_SESSION["translations"]=Lang::$ug;}function
get_translations($_d){switch($_d){case"en":$f="%ÌÂ˜(ªn0˜†QĞŞ :œ\r†ó	@a0±p(ša<M§Sl\\Ù;™bÑ¨\\Òz†Nb)Ì…#Fá†Cy–fn7Y	Ìé†Ìh5\rÇQå<›Î°C­\\~\n2›NCÈ(Şr4™Í0ƒ`(:Bag8éÈi:‰&ã™”åy·ˆFó½ĞY­\r´2€ 8ZÓ£<úˆ™'HaĞÑ2†ÜŒ±Ò0Ê\nÒãbæè±ŒŞn:ZÎ°ÉUãQ¦ÕÅ­wÛø€İD¼êmfpQËÎ‰†qœêaÊÁ¯°cq®€w7PÎX3”t‰›„˜o¢	æZB9ÄNzÃÄs;ÙÌ‘Ò„/Å:øõğÃ|<Úâø4µéšjœ'JŠ:0ÂrH1/È+¾Î7(jDÓŠc¢Ğæ ¢Ö0K(œ2ˆä5B8Ê7±\$Bé/Èhò8'ÀRì¼,ñ€ä„E P ÷ÄÃ#”7­Ct|¿\r®`ÊØœŠ·£¸@¼, PJ‹CË8Êá²Î £Ìj A b„œĞµ,@1\0S˜<ãBı=RDÛ#b×Í¨\\ı²J6ÌÚÔ£Ô2Ğbè¸Îk`‚Šr\\….Œ´(Â±O¼2Éh\$–£Ëˆµ;C\r‰›ÕB*úØ#®¸\$	Ğš&‡B˜¦cÍ„<‹´(ÚŒ’3A(LÒã+&iŒƒ\nj*ã¢ºì¹ˆ»¶0!à^0‡Èí«kˆmz4ç*÷Èš&k]àï&Mà,ê…!‰­ğ9^î–9À‹â:&&P`6CL;?ƒ0Ì6-mÚ91£”†3«KÈ¨7¡òHÜ<¢àê1Œiğæ3£d›\"7ab¢ã=>ìŞRèÚÙ3pä3JôåVY—IÙg’:¼¦ìçYâ}ƒÈ˜ê¹¢y^ZŠŒ[ª™Œ×Ëòá„É·ã–d×@c\$cj±J¸Ì„CE&8aĞ^ûè\\Šíğ\\³Œá|–§ˆDş7á}Ä³nİrÍºÎJ®2fH”Üñé6ælµ£¨ú½ÚÌƒÌsIP]j#FåºnÃ¦ñ½o›÷Š»¼'\rÆ`P_ÆÚâJÄ…ÒÃ§'{Å¬ğŞ‹!Á’5¦/l‘%Vœ®×«ƒƒÖŞÚJ!}4O˜®¡ƒıËèŞ]ñÆƒ–Â9E¨°Â33˜‰”ë:>^‘Aí3Ä5;@Â‹A\0csjœ4†ZGLÁ{i·›õğ )é{Ç°•\0 ‚\n@PL™‚‚j\nVóéÊ|6\":ºCq¿}g4Ë™\$e ëßA‰LŸ”LJqz\rĞ­ŠØl l|éØ«ÃÂ.As)iğ˜†ààOj@>PÏ§¤Z[²£Š\$0Ÿ–,^â i\"Á)… ŒeŞ nuêdÖF7æIZk¤#Ä€‘C|ƒÑ‰ı‡æ‘£	™De\$©×AãìxË\\\nsëôÃ’VJÙw\"ÇSGS<h\n¸q6kL3(¦ÊÙİäT;!Œ‰9>LÏq•kŒ/˜<Â˜T<‡×…\"TÉÌìYÄa|É®}ãşm‹¬®¹¸]Ê»ë1¤tÄ°Æ·H‰\"±<1K`¦BaA&LŒ`©Naº,G±)”)J‹3pEèÎSLÕ‰ÙmÇ\" „™ê¨gÂ¤;&dÍÏÙê¿§º£T¦ì¿ÇÌ—R¤öTSä‹±%!C™õª¸ÜQGî¨¼Ahh6¹XCk_pDCg\rCkÏ\r!™’„K_b^AT*`ZÑ®.ç4¥Ó”¨M\$Pé×*“a(â° INu—ø‚A×³Ñ/«21—øG©•4M¸9²“XpÀT¾…®,‚›RòOnI¥®•=b]é¤4¹‹Â(E©ŒM˜iŠÖ„~taiFA\\4òZUÏKJÄZ£Ôê¦=!HA‰›ôl!Ñzª§7(½0â^.oœÑVš¡dÁ¢/Ì¢)±BxK£\$ZÙƒ-mC·\"Öä\0";break;case"ar":$f="%ÌÂ˜)²Šl*›–ÂÁ°±CÛ(X²…l¡\"qd+aN.6­…d^\"§ŒÅå(<e°£l ›VÊ&,‡l¢S™\nA”Æ#RÆÂêNd”¥|€X\nFC1 Ôl7`Ó„\$F`†„Ç!2öÊ\r°¯l'àÑE<>‹!”!%ó9J*\rrSÄUT¥e#}´J™ü*¯ƒÆd*VÍil(nñëÕòı±ÛTÒIdŞu'c(€ÜoF“±¤Øe3™Nb¦ êp2NšS¡ Ó³:LZùú¶&Ø\\bä\\uÄZuJ¶Í+´–Ï‰BHd±Nlæ#ŒÇd2Ş¯R\n)èÍ&ã<:³‘\\%7%ÓaSpl|0Ñ~ (ª7\rm8î7(ä9\rã’@\"7NÂ9´£ ŞÙ4Ãxè‚6ã„xæ;Á#\"~¸¿…Š–2Ñ°W,ê\nï¤NºlêEË­¥Rv9Äj\nV¤‘:ÎŸ”h\\p³¾O*ÚX¨åsœò')Š–irÛ*»&ÁVÌ3J;îl1åBÊû+lÂĞø>ìj”\\ÊzÇ1,’ş\$q1büJ±{Í7!S‚.ƒjí6¢Rî±¾	)Œ¼‘i](Ë(Uì\"+EÁºq¹M?¡lÁj¤\$ºWA(Èˆ•\nUCËd4àPH…á gZ†)\rR‘•kZ–‘JJÌ”É\n/hAP¤u\$hRÔ12ÚÉ2e’ÈPë‰±TÉ•Æ#K5(Ï:UbÏjQm5½É[!D¨œ¥/Ú3à¸ØÉ1±z¿.¢wS­×º\\TÇ«‘DÆB@	¢ht)Š`PÔ5ãhÚ‹c40‹©\nÔlÄ„X—}JÙ£¨ç‡ƒ\nxC(è:P Ã›@ãòã|e¹x†7Ã0Ò3æƒ.yŸGa×Ámû„×é°L\n7jm*xjÚØÊ<7cpæ4è‘âA:Å79C Ø3Í\0Ã˜ëƒ0Ì6=c.²~ÑTdiI’	X\nƒ{P6æãÈ@:ìC¨Æ1¶C˜Ì:\0Ø7ŒïXæ6ƒ—0ŒãŸ§ÔÁ\0Úõ­ØP9…,-õI)t[§mp‹åPÌ/«iZ\n\0ÙŒÚ¶TõŒá\0‚2uct\rĞ{(Ò2@ÁZĞæ#0z\r è8aĞ^ÿ(\\0ù›ÌŒáxÊ7ğ–°:lŸ€D~M×‘¥çì[0^Ä9aF„”¹&°#\nH†\"ÄQu®¼‘…yzp\nQ)e Hj7aÈÔ¡ä@•;_¥˜¢'¬^Àe{Oqï>Äù3èy¨>ÇÜüûalm‚&^Chp5áµ÷‡GøÓb!½\rêœÚº ÂÍ(iCˆÆ<àÜ	ø¹.¥”Ê‘H´íˆ±`¹FÀEú^\0h4¡„1¿Fˆ¹®s!ˆÒ‡ñC”DTá„3A´0äÜ«—s.mÎ HâoM¤j †\"\0Ç	b(i!±³#Rà‰E(ä@•8b˜ÿˆì—o«¼Ô†€àA<*´E£GEI(Ä\"N‰<KCM7<èÚò\r¡¨5F°×\0Ê©ĞÓm6fı\n¡y&æÃ¼Ç'ìŒ r£`²˜–Rlˆ©õ´HåÓÁ@ÑDÙÂ€æ‡\\£N@†ö(†ààë`èsCè†8àÆSG{ ‚:H“JÃ*oD…&ÑdS\nAmËIºú„DÄ•/ÆíÒ²ı/du%¨4J Ë›¹\$€”“)2BéJP	mrü	2&„Øùœ¶Ğ¦q–…-­¤™ KPA\$‡“>#Ó™¤÷ÄÃ|lÙˆq¦É†d^SéyĞrv @ÆæĞ„‰™ˆtØÒB;ˆÔ¯”@'…0¨E‹4ÔDÒÅP˜rLWÒ©/m jDI%OH’³’šÕ5Ë!Ïm	éT‹\"[eÉm\n.X4Õä°Q]-Ö ¸‚\0 ¨ôw6ú(M0¢Fj†¶`¨-HnTá¦ ¡¶Uj½LF‘/”ôHÅF‘h°)ñbì“ÑÖ1‚å©âH	á	_K@´-\"H£na3ºìyÉšZ—/OpA“s¼©‰\0CÈ6º¾CkkŒØi'Tæª‰a¤38è¤H4ÅuL©ÏÖB F á«½’{.'£Rm¾¯ò\"|½›¤Š­#ëÔ[VµšÄä¸À)\0p_3XlXêúÇ’²RG-üÃ„ğXâÑBQ·yT‹p@²¢# ˆ‹\\{Ì¹\"(Y3ù.‚`oµµ¡²Ëèy„šIÀ’iM%k—Ùb˜ÉABL¤¹âz)¯³ƒà+›úŸºyİİªwdÒ1p-_À4q‹«®[I;({¥\"€";break;case"bg":$f="%ÌÂ˜) h-Z(6Š ¿„´Q\rëA| ‡´P\rÃAtĞX4Pí”‚)	ŒEVŠL¹h.ÅĞdä™u\r4’eÜ/“-è¨šÖO!AH#8´Æ:œÊ¥4©l¾cZˆ§2Í ¤«.Ú(¦Š\n§Y†ØÚ(˜ŠË\$…É\$1`(`1ÆƒQ°Üp9ƒ(g+8]*¸ŒOqšJÔ_Ğ\r¼ú¾ Gi‘ÙTÆh£ê»~McN\\4PÑÊò‚´›[õ1¼œUkIN¬që–ÖŸĞèå‘º6Á}rZ×´)İ\"QÚr#Y]7Oã¬¸2]õf,¤éµ©–¼—“D5(7£'ê†Æ1|F†Ã'7ÕêQşßLsâ*nËø÷¿Ès¸“¶æ0Ê,¬Ë{ Ä«(œ—H4Ê´ìÁ\0\n£pÖ7\rã¸Ü£ä7I˜ˆ0ƒÄ0c(@2\rã(æD¢:„Q€æ;Å\"¼š¸ë>Pš!\$Âp9r·»Åë‚¸îó0³2Pb&Ù©ì;BÒ«Cš¼°2i‚zê¤¨RF´-Ë\"Ø…-ÊK´A·ªñO©Å‚J<¯ä–\$iØƒ§,«²ßšJãµ)š(fl Äšã§hQÌ´-Ârã:Hz-¾;RÆµ3\\â¶*L4ƒõ=?T¿ÕawZ<¨Ü¡?‘¢B©¥¤S2tìÑ@í³>¦–JÂœ£S¨¢Ê£\"0ÓÍ+(lÛi{Jƒ>È5œ!hHİAªQ-Dp£YÊ:à·4I¹úÑŒ4ÙK·­_~QpM\0£JsªäÁ5«²l­šßˆ¡hÚ0#bOZæD§¹µ¤ˆ\$S\n9IÌ’Ö“Y×Lõª¹ Ó¨z:Ê²-¤¨ŸÖıµ—§m·1Ø®nèP91p™Şf‚™`Oe8th&¤æ¦Á P·§kŠaf.…ªy°¶1¡‡7˜ŒÛ*n«ì“ÒjØ@6£œt*Ø|9£ ê9Dc#ÈxŒ!òg¼oBŞ7ÃHÏ¿Œ¼?2„LF­ÅCHç\r‘–åDƒwAÑFı&ä2 Ê7cO30:âò\0PØ:U–aRÒ«5š	z¯7Šà²CpTb8û1?Jâš|Œ'nÆ¹™6Ì*ˆf¬:0ã¾\nK	Í–‹&)¿-ÄÆ£ƒïàzÅ¢µŸ§lã\nğç»?¨O32{%4¦=Â\"Cù\"o‰ö«”\0úÁÚzÕö>H·_‚È#ÏĞœWîö\n‹û5Œ Ê˜§Ğ‚{2-!S>,LÂ hpA­†gHİ\\Ğg2×4‰R`cva¤2\"P@Ş\0ho˜‚ Ğ p`è‚ğïÁpa‡°ı¢€Îİx/F˜:; ÜÁ>Œh²¹gíS¡şé‘› ÅXGÓX;„	\$Ğ¾ÂKc±ÏKdø¹â¼¦!%%QÑùHŠo+Âc`JtG1&%ÄØŸbœUŠáŞ,Å°Ü‰At^ŒÖ:ça£CzyÈ`ˆœD©œÁPSÏ¬é”¥øi{miL’ª³“Ìb§4DVL+Ç¢}HÑ»Rì‘AõæNé‹VçÓÂ0}¤š](RØ¢”x`aq•Ç‚\0îÆC` HÈ8\"Xlƒhe[A„3:àäÃcFÁÌ3YâxgsS¸4‡@Ğ(r2sóä6ùCte!±Ús‚Ğ§?ÇĞÃ¨ÂGRÄ‚,¯ÅbÍ˜¥™d+!@\$†Pi`^‘È‚¶\nK<“^Æ)’‚fãƒt§pæˆğ@iÌd2†yõSÑú7sÈà7£ª7B¼ú9E=ÉbNùæB·)ê©–\"Gß;o™¢TeVäØsH4	Ì¢:#_C€uH		\"%´Ã@it>xŸ<‘•a…º†ZÆQ«*£L\$±/’ÙoKYDG)2Ùßi»'¯v¾vÎZL»-¹\r¤ğ’Œ“ã-ïiG¤sbCˆéÍ)ÉŠ`³;>.ibP—gTï[0§+Ç#	 ˜ÇÒXiãMéQ2•á o 2p»Š&a›#Px\n:‡m´¿*-áÜ¦ˆôç(ò‡w\r*1iÕ€ŸãV,\nò¼ª±ñƒ«s›KÖ;í@Y¿LL=§!&\0['ÆÌÙ¾*Rı¸S\$šb®¹È»DEø7\"ãl&%ÕY‡”¶æİHÊy7|ÉäšÕ/…¥ıî#t ò’9Œw .*'@€)…˜K	ri*äŠ÷‚\0Œ)´œm&“¹¼Ÿ3*ƒ)mà<£µKğzËU+MViHó7U\nä¯!)™#¦g(¸\\ë­Ã›sa6MÊãG6‹\$á»#ò-ó6\\Q³~z,ØašëÖCŠ1LĞŒ÷Cç•éœZ\$¾Ñå?I4––‚¼\r€¬µ¥Ò>ÄÎòÑ™'ã*{øx_aÔÁóÜÉL“9a*“lÑMÙ}”Ó€ \n¡P#Ğqh©j`QlCC-¥*ı´fhÊª™å“¢ñÙõ7VTXé–ŒT2»\0ÚğD¨Xø)Ú˜%‰S«®É1§¨—ıq¿å|n¦Z˜¬ï=b¦2Ø/–<Å›Æd»lOÊ¡–{¬îØ0J?>îàĞ‚{é­TáÁÃxn¹Vt¨yÕéORüwwà|ì›Rc@÷)^G»Œk7Æ¦ÿ™\r\\ıS\"_r\0^í¤mÍ*×\\?lñ(Iq¶¹E8ã¦-Æ‚P‘7;U”eeO–zñi­°ïáÊæùõQáÃÎ™.ıâxù¨Ğ`j‘6²-ï wÉÕÃsú€";break;case"bn":$f="%ÌÂ˜)À¦UÁ×Ğt<d ƒ¡ ê¨sN‹ƒ¨b\nd¬a\n® êè²6­ƒ«#k˜:jKMÅñµD)À¥RA”Ò%4}O&S+&Êe<JÆĞ°yª#‹FÊj4I„©¡jhjšVë©Á\0”æB›Î`õ›ULŸªÏcqØ½2•`—©”—ÜşS4™C- ¡dOTSÑTôÕLZ(§„©èJyBH§WÎ¢Jh¢šj¦_ÜèØ\rmy—ioCùÒZ†²£N±ôür,ƒ«N®•%Dnà§®ĞµUüõ8O2ôín©Å­r`è(:¾£NS7]|ô†‡µĞÓ8Ø2É¼ê 4NÆQ¸Ş 8'cI°Êg2œÄOyÔà2#£Ø:\rKô:#ì:E3¨©Énƒ”m §;KÄB+ñM	”Ğ¬#©îêG¥.›¼S9hš†ç³åò6Ô«mƒTëÅâdÇ\nÙQÁíªè D\rêI£lëjá'Êú@Ep{¬º”ÎÌLÛDĞ¦õ\r#pÎ2ñ*bà+\n¼‹D±úN¡ÄòtÉ¨Ã„–+Hğ*Ã[Ü;Á\0Ê9Cxå0o`È7¿/hŞ: ğáAR…9ôÉC­â7K‚µOÃªxß«¬ûNî¬ÈÜàêÅ%4è­–²}4°k[Æ¯#m¬q8	ƒäCP{]G©Ò÷:Â\rQ-R(1T4’Õû¥7í¢âAMõÜc4	Òš®ÔDa»ëÉ*;6B‡j(ëÓcİÖetË¢ãZ ê-šQÁ±k9©	ÒºD»M‚¹<Va\\Ù(iåÌSÔWÔ<P§Q±.Á3Öº€R¦Ø¢-(-ØÚ¹ºìÓW.0E{\$PöT£&Yf\\€Nk›­«}¦‹AåÈ<¿ SÜ°\\šXbÖ»‘)8Ji:»/öAf\\pj·+GÊ®@*Kp^5úq_kË„­µ1ùÄ@{š¤C…ª†®–IÖA…®„=ºÕeÄüXC\r¶d¸ã|K`‹âa@¡ÇùŞ8Ë«»àPƒñ±,l_…2J‡ÉëŠŠWsØ\nìÆã”™ÖmËÌÜ×94-İEÉr2:mX_W\\”Õ]‰@t&‰¡Ğ¦)C \\6…ÂØÕéBí”ƒïó‹IxÉµá¬K	ñš?Chê9ÒàÂ³ÃÊ:£”ú0şt\0Â<‡xÂAŸWØÃxnÁ¤3¿Êş_Ùe?Iv(D‚O´\n\n	?è {lU¡”<  ÜÃLjqy,Ç>ˆÓplÈSÎ_tÁ˜6%ĞË	\nCÄ¡f2ìÅ1›a¼@Ş{Ãkô €:ÁğêÃùa˜:†À@xgK¡Ì°åÃg023°Ú—CªÌÃ…t™Å4<+fM«GMˆ8Ÿtì‰ß,2rJy?Aš\n>tºÁ\0A‘œ7'øºái‰ü>£Ğûƒ0=A :@àÁĞ/áŞRàÃ\"á²ƒPAœ†PÜÔ\\†W‚ },P‡ñk•ÕV¸Èñs¡‘³NÂÅ»§Z¤Ô¬#H‹Ş˜,•\$gÂí)È	ª!#à¥ÔÈrfĞp8—Ü¦ä¨a’á–LÉ¹;'å£”²F'ğ]*ål¯ƒz@^Ÿ`I\r¡ÀûÙ\\%Ü È7³cø\"Hk=¥J§ø“#CsÎ—¦™ğ¨tÇèëgY­¦f+bA4W´ÇN(DäHØC³€ €;ŸX¬`pOò9PflC4İR1B)EH­\"Ò}¦¨ı†ƒØÃ\rsĞpÒCd#;iRk*††•C\rUhøÒ*¶§‚€H\n­j=ÑLÖ×‰WDô‰S¦eT]Aft(¹f16*za¥´ä@\0İ#iŒ‡?g¼øŸ3ê}Ã+6RaÈ:@³ô{”…X‹ŞÈÂC*ç¹[bDYŠÑò2`ét1@À‚u5-A@”L7Ó7Ãš˜STÑ†0ÑD \$œâ¦ÀÆ_<7'E-hŠq¿A\0C\naH#ã¸àO8L¨\\ -EDxbÒaŒ\rÜ:Uˆ)®aMD¦\\©úãv×‹(j¹Ş2y[›zı.%%buJÕ¹‹-xÕõš+©2dvqõ`İ¬xœK[KİŠt‚ÛŠD^†à©—•ıxêY›\$ä\$0òy\0d’J9H(İC)ú}ÁÄ:Ÿ• ”m‘2¢FÍëfŸCXQ56Õ©cñ	:%%JÄPÒP Â˜T#y5fZ\\)²¡[¯÷õÅ\$BâlÊ¶	eŞ·½ì4–ùY^,™‹KçÀgŞáy1ù–\n|8b\nÌG“\\tú¢Ä§µ—\0¦B` €pDúN Œ+[ôfÁ¦©KcñÉOç­A¸5âáU‹1IÉ¢aM‡V™XZ6FNîÒ&gyÎŸÕ¬À¼²©”l@9Ô›\0¯xøê£ö úƒZ8·G°³»U¹q)•\$­5±	µÕzú°Šm^N\\³>4ßY2ó…¨Š¶¤EÈxÚÇ%c{õf¿™Î°8V^A\r!Œ5Á7æµXÆ¶.ˆPĞÒ¢]AÇÑÎ¤.\$\n¡P#Ğqd†*KÈ3lİôV¾›'mé ×¶N‹7R­Ö\nkëÒYº¶´~u×[m¡®0/øÖÈã¤l®­CÈ‹Ï\$Ú4ŸjjíƒS6±!ÏnÓ/g¾•ùÚòÁW¢‘\"w÷\0«xMjr|'h˜	yIK«¬¡ãšAÑƒk¾±Õj6µx:ÙªIš×Õø•pƒÚgıy‚\r§	Å0™]Y×\0'3¿‚UÁÈ	¿AÕ¢”0\nğrC±í°ËË¤MÈjüQÉ‘×Nc@è¨ˆ„â¶V[îÙ‡4•òæÑ[<Ò²AL2Ÿjcdz™«„ê¯’yÍú+†vWœ-‚uµzgék-ìR7’H;R›	©Ÿ0¿‚ß}5#îmœ';ì³só+3°ëŞvâE@";break;case"bs":$f="%ÌÂ˜(¦l0›FQÂt7¦¸a¸ÓNg)°Ş.Œ&£±•ˆ‡0ÃMç£±¼Ù7Jd¦ÃKi˜Ãañœ20%9¤IÜH×)7Cóœ@ÔiCˆÈf4†ãÈ*ˆ šA\"PCIœêr‹ÁG‘„ôn7‚ç+,àÂlŒ§¡ĞÂb˜d“Ñ¶.e‹Š¦Ó)Óz¾Œ¦CyÛ\n,›Î¢A†J ¸-†“±¤Øe3™NwÓ|dá±\r]øÅ§Ì3c®XÕİ£w²1§@a¦ç¸Öy2Gào7ÜXÎãæ³\$™eàiMÆpVÅtb¨M ¢UìÒkî{C§¬ªn5Üæá”ä9.j¿¹c(Õ4Š:\nXä:4N@æ;®c\"@&¥ÃHÚ\rošš4¬nâ\rã#ä²Ê8@ @H‚Œ™;Í˜§*Ì\0ß¨ƒ ë\r¸Ã²è…±€P¨‰©«Êì´.\"k\$b—Ã#Œ£{:Gòsäºh²l5¸Ïª–Ò±L‘ˆH´ãKDl:âÈ\"bVœ(àP¡*²ÒÚ5'-ÔÏIÂs*”ÅˆKIèĞa\n5/ÔE	COàR) PH…Á gL†)æÆ­£<œ14ÍhÎ2:‚ææ¤rzÚ‹rp‚5Œh¼œÂ/ïóÖ\"tdô¯ÀP2\$.B<;NK¢<==uSÒ»©àU±R;_)v|¥)ˆBüQÑåj¡–½~P¬c›6¥»HxËpZkª”ÜÖÍÑmÆWj c\rˆ\$	Ğš&‡B˜§IBÃhÚcÎ<‹¬õ\\®‘“`ŠZMXÚBàÂ Ì”t´ÂÿŒ#ÈxŒ!òAdŞ7Ë+™•å±[VœgJh¿´ùÔH9?©‹n†(„2Ü99˜æ	£À6JŒÃ5’²Q Ì3&ŠKrÿ\$£•…TO’ŞÖ¨HòŒéã¨Æ1µC˜Ì:‹\0Ş3§˜X¾[xÃQg™åÃ\rÃª\$aJ@*£c+ÒœÄ³Û,\nŒëğÕŒËš3¨<a\0‚2qöş1êCK»¢cÌã\$3¡Ğ:ƒ€æáxïİ…×÷J9Ë˜Î±{(˜¾¹˜^Ş:œùÆ\\\nÃ\r‚5U°@ŒjÃZ¿ÏNUÓn.	l.ä\"Z á	Bƒ”M¦K%hÑ×ö=ŸkÛ÷=Øîï]!8?Ï9<7ŠÓsPy@‰Ú\r9Œ\rÁÑé4\$¦)¬\r´ŠT G“m)0M—5Ü‰k{¤b–‘é\rfm‰½† BÜÀh!„1¼“øÍ3y0ˆÿ9ØBdÙ(f}(-¹·VîŞHó|‡è€4ØtA	Œù˜ƒê]Ú™y/d¨ØâŒ9?fÃšE¢¨P	B2 4T\n\n\0)4•ÔBI2\rÅ&½4hÍ)§5(™FvjË‚.äx;™2@ƒ)–I‡y²Zn:k¦Ñ’GÖİ)ü6D0œ„CšB €;›0ÇL0gvj(†J¸¶HÒï\$2eëã¼q‚S\nA\"U|œÖìiDÊšØŒÆÔñ’m§¤Ä=²ƒm\r„YE#rTK	q0\r1T¥’óÁ4Cfôï(f‘BI-l2:¤„™ˆDÆÊR âMRÈ\rº7¦èc#Ô+JGÖjfÌ™#§¼ã\0Â£ÊùÒÆCˆ\$\")åÇcŠXRüõQ„1F’àSfk4fÅµZ³4üˆ™õ3è±­µba_Ò•Rp@ÂˆLÕ šRR‚¤t!(™\rHØ=TècØM”Ü—àìŠàz<ìü˜ÖS=Z%a…0ä(Äp§Y‘SI#më\nêHJ%\$bb–wäBLáP\$1u2T™a•zï±UàãXK]yA\r*ÀV÷yÇÔîSt!\rCMr&ÔcM7Øä¼• €*…@ŒAÃEuôñØLüæñ\$²l7/~dÔ›—Ä¨—æŸî\rË˜ÅÂKÍøTN+0h¾«ØO)…&€7¾²¡YßlôÜõÚ“¬bZW>ˆô½ÃBS{«™›2´Ñ™;LB©6D	ñ\r† Şzi~N8›Öh²A’¥ˆ-sFÒ§»6”A’Mà¿E¥qÃ\"á~a‡5\"®9	.!¤Øs~a	hz1XÅdª	‹‘)ƒ¦lÛÚ®òN\nX™:„/‹‹èi\0";break;case"ca":$f="%ÌÂ˜(’m8Îg3IˆØeL†£©¸èa9¦Á˜Òt<NBàQ0Â 6šL’sk\r@x4›dç	´Ês“™#qØü†2ÃTœÄ¡\0”æB’c‘éˆ@n7Æ¦3¡”Òx’CˆÈf4†ãÈ(‹T—PfS9Ôä?±ğQ¼äi3šMÆ`(Q4D‰9ŒÂpEÎ¦Ã\r\$É0ÁÖ³•Xñ~À`°‚6#+yªed…“y×a;D*…Üìi‡™æøš‰Ôá+ªâp4(¼8Ë\$\"Mò<Àƒk¶å£Xø¼XÄ“à¯YNTïÃ^yÅ=EèÎ\n)í®ój¼o™Š§M„|õ‘*›u¹º4r9]¸é†Ö¡íš : ²9@ƒƒü9ë°È’\nlê¡`ê«Ø6=É:*œ¢z„2\n«&4ìšŠ9©*Zz§\rI<H4ªŒ²H¿£*‚ˆã¢Á®Ìˆ†‰;I¸!/HÀÒÀğÈˆã+Ğ2‹»\"*\r#„&¡Ä!<&:ÉK3˜»3j‡/sîqLªÿ;CË\"\$ÃHÆ4¤ìb›¡†fğOƒLüÖ&£ÜíŒÃLŒ©³œŒ\0Ä<ª M!IR’0ó#*\0PH…á gP†3bDÃI8ã0\r‹Xì7£ƒ`Ø7Œ`P9'KÚJa•©M Œs¼ı@!öQ]M¯ÀËEØ²©†YNµ«‚(Xê„*¶¢&ŠÎñJ\n\"Í{\")„ìÛµq@”¸Æ»2¶`Ê1ÙÖ„ì7#û\\óÅÓHİvT·F^•ŸhÅ•HäÈ‰@t&‰¡Ğ¦)C È£h^-Œ8ÈÂ.Ø—}º½¨r\"\n£%œ*0|Ê‹síC\"/ÀÂ<‡xÂ\$™FU6ÈòÚÊæ¹¼Vã>Ê3-ö†»#KŞ•’i™\$I!–òH&C‘ª\n6J SHÓ#€Ş3Ğå\$MxÉ28—XİCŞ¸Ş¨¦Cpó²c­ƒ>ÌXAY¯,œ1*îãÎ0¯Z\"‹H¥#t42…˜Rà&ûu˜Pwë+¸¤‚¥î5¨C6™	»Á\0‚2q©1·!‰Ò3”0l¨Ì„C@è:˜t…ã¿|\"]JF»á{´íkÛÙ…á}ä¿öƒœ\$©:Ö…ĞE›N©N:pk¶@èÚ3ÀäĞûÃ	¯òªŒÁH\\\\{ğË„€ÑÙv·pîã¾ïÔ¢D#Æ\rÏ¦«Á* èUF¨‡¦ĞÉ°t\r½H‡FèCY#ê97UIUd@›ÂÚ`‰¤%b ¡ÄĞ—ÛØjÀ)Ï\0Â¼8 æÀ\"!]%~äD3>ô\nŞÈ[}V!½ÀÄ\">\rÑ'ØÎUr{ãHf!©Àç²fš0¦\"\"¤Õ9B\n ( TEÉÑB”4hBS©¾…¥¸ÀÜÍ¡¬5ÆÀ¶D¸îP‘¡O\rè¾+0îıáD^;IŞ0´@ìKäys¡ ‘B\"„õPc„GÚ\rJ´´‚P[óR!ÜÀ†8°JC;¶RDBV™ÀÂ„Íü<\rğ„û0¦‚4”¨\0¨ø‰:2\\/˜²ìLZJB–hµaÉÙPG&T”â`™Š!†!°'@ÆeTqEd\$0òicò‘@iì7AÓv¬+*„tü¦gNğ¢ÉöjÌÿÁ©\"‚“W6d®<‚\0 Â˜T ‰øû\"IÃ;2s4)?pêr£u6eD½Nø*E“É9~Ñ\0;\"8ŠYñn‡ïfyµéğa±¶VdHˆ©\"ğ˜Q	„ğ‡‚Ä0TªH“îq f ©ì9’Fx&äv<p(Éã6ÌÜ?e¥ñ JÊCë=`3gL‘zÜ	ë2ˆhÕÈ–AÀÒGŒ2ûš´¼:/EìÌm~°ñÅØ9âÁB1³\" €!¥PØ\nèZv¨¶Nš«7àS¬I±oY’@#-ˆÎ(*…@ŒAÃM]f>CÖƒ¢Bµv±¦}%S~½fáöªÖæÆ){xhI¼ô·a¥µŠÇÈÃ\$æ(Æ>ËX‹•;Q|RSÇÈ+÷2©\r¡Öÿ^r²#S¦{Ä°Ô1%);]Ã@%?D”7ÔK9\rÁ‘	—öÚğ cÑ+YLaDF«h71uÙ‘©o”¶-–õ±ÕàıÓb³WA<GtçnBBTäå‘4Öşlî¢F\n’şêÚtD˜Œ€-ƒfĞ:\0";break;case"cs":$f="%ÌÂ˜(œe8Ì†*dÒl7Á¢q„Ğra¨NCyÔÄo9DÓ	àÒmŒ›\rÌ5h‚v7›²µ€ìe6Mfóœlçœ¢TLJs!HŠt	PÊe“ON´Y€0Œ†cA¨Øn8‚‰ç‘„ìd:ÁVHÉèÉ+TÚØªù…¾X\nb¯c7eH€èa1M†³Ìˆ«d³N€¢´AŠ¾Å^/Jà‚{ÂH òˆÔLßlPÌDÜ®Ze2bçclèu:Doø×\rÈbÊ»ŒP€Ã.7šì¬Dn¯[6j1F¤»7ã÷»ó¶ò761T7r©¬Ù{ŒÄE3i„õ­¼Ç“^0òb²âàç©¦p@c4{Ì2\"&·\0¶¢cr…!*Š\r(æˆ\$B€ä%ƒk€:ºCPè‰¨«z†=	ØÜ1µc(Ö(êR˜99*‹^ªF!–Acşµğ“~â()ŠL££H=c(!\r) äÓ<iaŠRB8Ê7±èä4ÈB«¤ÖBã`æ5˜kèè<È\"µ-ˆäçÊíjp	R \nhÒ4;åæŞr¨95úú8NS¢2í&k¸œÕ¼(Kp5ÆA(ÈC,ÑÔ…%/Ò”}#.`PÂ7\ràT°\\•8b÷NCĞ5Œ‘b4ÏÊ†Œ3(&\$ìˆ‚5È/pà9½(Zò¡ëb9¥ƒdÔ6NkP6´Œ\\âLÙ£{óeMÏ@„<7##tIGŒ¶8Â‡…ÀM¾67—:×+tÙ…Ûw¢7r¢7½Ô‡®i.bó`	¢ht)Š`PÈ\r¡p¶9c»aX»ü(á\0Ú:Ù‰hx0¨áğì²È(İ2‡xÂ\$Y>R'0ğÌ4Œã¬\ræ9œH9¹(-g(a}èjr>à&f™NÔ”LĞ©nCiú0¦2¾ƒÛ1jS8”³Ã0ÌœÀJPË>möU;26½š4»Y@4\"(H×’.w]@Î´#LÖÿ´/È‹èÕÃmı*6È­ƒlîÅjs¼»Şúàğ@!ÛŸ–qVI¦6<M@;r7>EÊË÷o3Í¦¼íµÏñ|ûÂPe³Ôñ}g×ö<Ÿh‘	ã'Má4Ét14“¢\";8»)¿¿‰c	Ä·èL(Ü¥\0‚2r…Ädğ@ä2ŒÁèD4ƒ¥†áxïı…ÕÏÒÛÁq à¼1‡0^y¦‚ğD iaÀÒ!f`Ìñ:ƒ^“\0ÔÛƒšw\$Ù0%³œDN„0Î‘'¤„jqîÁ¬àè¨	êYÆˆ–7Ä·a!d„çì>Ò.ü“ô~ÁÍü?§øÿ’,\0€P.¡nÌ¤\$†ĞàL’ˆnEm2\$zBŠGqxÅóZCÈ‰=%!–E˜^µ\r)pdL‘ò†(8ËY1P¢¤‘+ô‚¤ª±…äİX‘S€º‚fí%\nœ+Ğ|©ä‚!pÔJÅë”pn•g£ŒĞˆi’è…† ÒH‹É{MQ«\nÕ¤’;ÑH8G£,’ë‰8‘œi@~\0P	@KC·-šÃÑ ÔäBCRˆ/E–EhCÃ(g˜ĞrK’\0è\\Ğ’z\$¾A*4B!´z“²S¾Y#+c¢pziù	ÒæcÈœ~¡ÑÄPˆDŞÁç!rZ ²&”CÓo?dxÙ@ãCY3)… ŒÍVâ„™4ÀÌH….¹È%ß(Ñ8”hò’c8JŸ,ì&T\\„Ó9\0wÅm AØ<¦˜Y!‚hÁAĞ(ğÔã\"»­!&=\\–dDSˆJ1'3	ó¿òÊâú#5î´‘‰¶ßß\0vZH^k-‡4Ş	©70g„(ğ¦/õ\n0¨F™^û\\qÕ£6ø[Ãy¯C°%³Ó†#eĞi}á®ÔF†H‚±8K‚ô0¢á)³øWĞ˜EH¹´7Ê‚Z‚¤Ì7ä›°‚qO-À¡ ÒbtEòŒR€ß‡3Ê—-©Š,ß†+ˆo¬ u\$ä=M¢+o®c!¹Ë8›‚gDéy«'&ˆÒ.e+rab«¹p/Ä­\r¥^Ê>ô^£{‚â:·Âò°è[H­¤\$A: Ø\nÎñ:¾6ğ“Xq	Ûˆ²¾`Ÿ†ZDÃÔx\rÆ)Z\$PÈÙ*ç!.8—+å\n¡P#ĞqK—\0 ¶“šë;+ë€WİíÆQ{b‰·|ÜN\0lWİ~c»ku¯öA½8‚ÑBBÓ•ù“•aœsf`›ûGÃFE<ËËâcÑ[aÔÄc\"ğÆ4…ù.ºÛ¨úB­0…(Ä9™.f†h0œD`ÇÌÏ¯,}œgáZ\ny<xr¨ÂÖO	‘v (!“ˆ8M åV'µJ½­6¦L²Ø{açPiàÖ§B{a¦eÀ² ëÖ(x¶ *.ë0¬UmzĞeüäezæ(OÀ\n\n†,#\$vfèK8˜ÜÛB«*Ÿ¼§ì";break;case"da":$f="%ÌÂ˜(–u7Œ¢I¬×:œ\r†ó	’f4›À¢i„Ös4›N¦ÑÒ2lŠ\"ñ“™Ñ†¸9Œ¦Ãœ,Êr	Nd(Ù2e7±óL¶o7†CŒ±±\0(`1ÆƒQ°Üp9gC¬9ÁGCy´o9Læ“q„Ø\n\$›Œô	)„Å36Mãe#)’Õ7¸Œ‡6˜é¹ĞNXZQÊ6D®›L7+Ìâdt“ÍÚD˜Ø 0\\ÈA„ÂÎ—kÅ6G2Ù¶Cyœ@f´0˜aÊıs´Ü[1Ö‚İèØZ7bmÀï8r™ÀåµGS8(ªn5›çzß¯47c×No2œÄ-Î\"pÜˆÓ™ŞĞ2#nÓ¸Ê\0Øµ%ª‚0 hÂòÁ&i¨ä…'#šzŸ¨(Ä!BrFèOKB7¸­²L2B˜è™.C+²¶0±œ2ƒ´b5¹Ë,h´».Û€:#ƒ\0¾7éºØîÀNÚ;\rÈ0Ş‹?àP˜ã-‘@ ›²HPÜÑ\"k\\š'-b…A(ÈSÊÌÓDÔ‚C…\r@PHá hŒR—»£@ì´k+6š:Ë\0&\$#K\$2c\$á\nÌ(Øîˆ¡k\$ŒB0å9\n”rf\nËèĞÂŒÎ¢M­ˆÂŒ •XèM“=\\–V,g9 P\$Bhš\nb˜2é ¶a”¶eœR‹µ%,Û\\Êù\$PHx0§Aó.:Âm˜Œ#ÈxŒ!ò7mÛ¢Ş7#=À2Ü÷L*ãÂ¬zŠ»/7ºÑ_ˆZtâ§Ê<%CrAwÃ”b‘X,êèÂÓ\rã0ÍI©qJoÄ2›l:Å ßK#È@„>ÃÆøc0êÏË«`æ\$£–T0Œõz‚¶'38Ú¶©PP9…(ŞDĞ p(Ø6*Uv*\rš>Ûßãª@¹É¡¡C–p1áƒJ,œ[a\0Ğ™ÁèD43€æáxï»…È®À½-8^ ã%ŞĞ7x^ÜÚ“.W­Õx\\´¡' Ø—®íZip(İŒğLª†1(Ú;‡…£\\2¿ñ§)•Ò\\ÄhNÖ2í»~ã¹î»¸ï¼ëëfø9oÜ„ò\\=º\$¨“b %C—‚È‹k+äÜ'\r@3¥í2,ÑHC”³è#baÂ¨/°àüO¨Ö·@‘Š9òå/\\Ï#z¢C&]à€;’tĞBß+Ü:	=Ys0fLĞÚ´\nA%3d0\0@ÍóĞ\r%¹ì³fB(ºDiÈ‚D´—™ƒ8€H\n\0µ’B’,M\n@('@¥×™çÀ)‘k c«¸ÔÀIQ!Ö\r0¤¼—4Îü\rÑ>GĞĞ4óÆ_HØUáä6\$P@—N:g\räH<‡0Ü‘ËĞ\nÆ˜¢š~Ùzøƒ,¶Š~áşIœ;†€ÒàËC3Fˆ»Á¢ÃZc±Š2óDÂ˜RÀ´²ò‚æÍ„o9\n­ì\0Üéˆñ \$DÉš³>‰˜tIhP7²\0æáš4bàÛ9ç@‚IÑ	\$<±SNÙ˜o>²’GRdC©ñ4A˜ë’F¼ŞÉÄ{(!Œ‰éš|Ùs•\r\\(ğ¦\r9ëuòÔ›Ëyrí\$)´ÒsPÓ'I«(M<¤(K‰2ˆı\nº•Ş¼W„]æ¸ô•×æPH‰\"¤Ùö–BpÂˆL¨9B0@‚ PD¤1æ¨§Ä]& aV!ÉPÀŠHRb'á¥wKéŒëUè»2³L+¦oy*‘µ[PÒÌ…!È‡«5jPª8(4ÔÊ|ÑXla­†º’)^¢6Ò4½“@h d¤òN¡‚üÌıb€€*…@Œ\$àeç'¤zŒ™ÌX¦)N¼Å‚S“m1¶’¿FÂY“)\$=úŠe.jdüI£CT\\‹q¨\"À(¾ˆØ@Q¾/è…\$›ÒûjÁj“«Ïr³š8‘ZˆY¨56V²L#åÅ2Ø(óå9cpNŒ*D€Á’¥|LÈY2>ÌDĞ£DË`a©ö(°*BÜÌ8K\"i4\"‘ø°\\,kÑOòòâÂê]çâ!\n–fÒQ4Cg,ñ%H!”";break;case"de":$f="%ÌÂ˜(o1š\r†!”Ü ;áäC	ĞÊiŒ°£9”ç	…ÇMÂàQ4Âx4›L&Á”å:˜¢Â¤XÒg90ÖÌ4ù”@i9S™\nI5‹ËeLº„n4ÂN’A\0(`1ÆƒQ°Üp9Í&ã ‚Å>9ÔMáø(Øe—‰ç)½V\n%ÅÍÓâ¡„Äe6[ä`¢”Âr¿šbÆàQÆfa¯\$W‹Ôún9°Ô‡CÑ–Ig/Ğá¯* )jFQ`€ÉM9ß4xñèê 0šÎ‡Y]šr‡gÎxL»SáÚ¸Â­@w‹ÅBş‹°òx§(6ÊnÍBh:KÖC%ìñ-|i¸éîz9#A:œÎù¨W ª7/ãXÂ7=Ép@##kxä£©©¢*‡PÖæ@£’‚È³ŠL±„€Â9¿Cxä©°ŒRfÊ¡èk¦¤1CË†‡¨¢:³)J\0èß¨HøĞ‰\$‚ĞÂş±‰¨ê6Â‹(´èR[”74Ã£°!,lĞä	Ã+8èCX#Œ£xÛ-.ƒ+	Æ£’3,qâù=+^:DS8İ3²¼=ñè	ƒxÎ±SÜC ÓÖÆK#¬Ëh¨ô«(„<¢ÀM*Rè²\n5 R÷B°\\•8b°®+¿ŠhÄ›®SRöÆ0©ÂÛ\rÃ;îİ\r(”o¡ìênÒ\",`Š¤ÃHØ\nÖ\n:80ÌûÃC5^ÌÂÅ*-3MÙvjX¿#·\0ÆİÔÒËrŒ6pæÜWJpÄƒT´=Oâ@	¢ht)Š`R¦6…ÂØÕ…Bí†Å·ËöRH”¥æ6¿*x0¨ó€İ»ÂÃ¾ƒÈxŒ!òIã¢%6ã«“å*ç(Š;\r`ÍûHĞF#|TÜg™òĞ5éğŠ9:R\\æ¤Y°A¡@ÙÍ=e¨°Á«Kœ7ÚÕŠöÏ¥Ã²ãoLcbÆM¾zÀ'ÉpÌ7ƒ8Ø7¶!AÁh¬—ujÖS‘2|8C}f—gğj<ŸÆ(š±Æ‰ğÜ„\r	jÆ•\r—nÚˆ)«zZ9n{®ï¼ïkıÀpL÷)püOàhüvoÈ„œïˆrèO47s‰&ĞÀš‡GÒ×KR	5t?y´È6¬p2E<(Mş‘„ÛCj‡¡Ñ)˜t…ã¿Ô!¢÷ÄC8^†şh’+`ÁxD9vÖsÖpl\ri‰1†àBÍS\\3@9†@Â£šè0<ãZ¬İƒ£/hÑ‘6–Öò×™&<aÈ¨dú¢Òô#¤Â\n¸G¼â|™ô> îû›Õ~Éù?@ÊYi\"Oé„Ú|Gn07@‚ÌƒZKR	©iÓZ‘Éjó8aÈ•+r„m*UÄÿ\$./àg#&Dé…\0hS#ÑÌFò¼ÍÊ;mê Ø–4O‚\nÀ\"P5\0Ü}\\Ërn\$í‚\0‚ğ#Æz…	µ›ØöätmA–1Èéæ†¼½P@ÒÚiÒj±”V¬Jq””ÍæÆ`è†á¤ÑÂT·x((€¤Ÿ” ˆdFÁ·óXŞ*½Ä–z[ÔN—Iù›Ìb T0&Q‘^™´±äÌ ´\$†æç¹FÁy¨2dïÛÑpKWôc•é£>‡C[—œQ\n¨ZD‚ôiIÒ\"Ä!…0¤\0T\rë‰\nyÌÃ;„Jf(„dDÆZjXh2ÁÂüº—Œ\$œ”’¹ÃÉ”€\rÁé!’Æ†‚\$ÙÓ…&D¿¡b]ƒÜ¤dÍ’å´-‹Yƒ\nä9Ú“æ’Şdxf>„vC¢„²dt9}àt¿ä´hM „€¦“ÇU>M8’\0Â -2ähM3nNy<p†¥â‡¦ë>ää“Ö¦ĞÛ4<±•¹´ƒITÔB1C%²ònÌ§‰ƒ4®ˆ«w~O¬n,ÁD&W¤F\"Ú\n@Ğ¹‚ÿÎóÎ@“\$G ådgğpOÍåÄ\$sÙ‘\r¬†\0#äH¤.8w¹6 2­´UsÖ\"‘3ˆÆé&¦âXå	‘è‘M„FM1,/ëQ°BĞÖ la-X®ºü’)Ö—È¥ÇÙ…=L‘ÃD\0€*…@ŒAÁ¥hHğ‚¢H¦îœ¹zàÜ2œ»p…Ù3H×	¿òSp¯>>ìJšä_Uƒ¢#Dp\0ÂdÆ„™GpRòlHƒ \n5\$-Ï%^aŒEûNÉâ·âb6×ã sIUïìÚd’)ÃÄ-¹è	„13W2,[—Ş_L\nD6\":ŠÃ7Î.ì®CŒÉ›3¸PV&B²ıôÇÆ4<b–í\0TFÏÍVW!FM™‚X Àöœ0Şse­u‡0";break;case"el":$f="%ÌÂ˜)œ‘g-èVrõœ±g/Êøx‚\"ÎZ³ĞözŒg cLôK=Î[³ĞQeŒ…‡ŒDÙËøXº¤™Å¢JÖrÍœ¹“F§1†z#@ÑøºÖCÏf+‰œªY.˜S¢“D,ZµOˆ.DS™\nlÎœ/êò*ÌÊÕ	˜¯Dº+9YX˜®fÓa€Äd3\rFÃqÀæ•‰Ğck[œ)>®Hj¨!Üuq‚¨²é*?#BİWğe<“\$¯«]bè†^2‚³¥n´åõ“>–ã¡øz< ³’T•ÚM5'Q+“^rJÙU)q‹s+4,eÁrÎËÄ5˜ºÆ-¬¹ç©3J7’g?g+¹1œ]_CFx|÷-Uƒ±³¤tLê¢»îŒ´)9nƒ?O+øô¿ë¤‹;)û…©î’òŠ©I‹jŒ¶èãt–P#öşÁ0\nQ!ğs”ß'®\n|W+ÌÙ¦©êâI¦HsÙ¬H<?5ĞRPƒ9î»~É%¤3Ó™ÅÙG(-ó4C²OT\n£pÖ7\rã¸Ü£ä7I°ˆ0ƒÄ0c(@2\rã(æK¢:„Á9@æ;Ì\"ÎP#ŠK[ÉDrç())JNë¢O1~ô+LR0=ò8¥¾*€•Âªqt¡.é:M¬cšÎ´­izb­®m\nŒ»­‹ËòÉ:ê¥‰ ÄºšÉQè‘n§¢”´±Ir\"MUq‚Ñ™Ä¤ ˆE>FH	•>Ï!–dhŒ»ˆ“ØÓ·kAF¿v%ôÒPœÙ(Í£l©7*Õ™Ñ}–î¢Í*“)(WQ4àÚ.½¦• ÅÆ§Ú(Ì¦gŠbFDfvFá\n&N™Éå,§'ÎÈá(ÈCÈè29I“MÈ3XŸ³I`\\A j„pÀ±mt#tT~º¢ê„š©¼JÚºú4__97R@¤ºöc‡9ÍGpİAvóÅ`PŠ£Ò6CÔÂLc.î!Õú\$¨µ›JªAèòNC‘Œ»&Ì6*÷m\$VoE¸]”ï›öÏÀâÕ\näè©²G&PH1Rg!ÑœMó|ÓJ Õùn¢åà^-¦*wT.°ë«¯¯§…ó¨‹a+…{¶î« @6£œä+ |9£ ê9Kc“/#ÈxŒ!òmàxBŞ7ÃHÏãŒ¾£R„L¶²LCHç3\r“Wu0KƒwÑõMÿgt28Ü9>½LƒsFğbØ lÈƒ	#NrQëÿRdÅk™óŞ¡a-Dæ­T„}İ¹@KÍ»H ÅXR?]m§µ¶¾Üˆ¹<FÅYÂ²ŒPÂªR' ¥2‚«Ğ;[5è>—BJD,v‡œË±BìÆqµh¥ØÆ©7tŞˆÉK>”h—	‰C¥wNEw\\h!‘‰†Šò—hr¤\rL‚LX”¨„í¼FRGV%ñYLdOkñEP+3ÊPHdk)È€ìÄ…¼‹a|`&›@ĞòƒZoÏ±Ş¾ Îd\r¯‰.Ä ÆşƒHdK à\0Ğñ0=A :@àÁĞ/áŞZàÃ&¤âaLœ†PÜÓcîæ_‚ }0S\$–{ÏI\\ ùLHQÆB„òÄ’1š\"D>äABÌèAÍAíšÑ,Vqáf±Õ-ëır5C&E—ùÜ`'béHe4¨•R²WK	e-¼¶—¹.‚éw/eûô~Ïáë‚ğDğ—\\%2FAr®ˆ-fYòêPE´KTO'Éï‘Vò\\»„…sˆ^0ãĞ£SùË6h˜ğ,–^Jt+C*8ôBˆTÄhÙtğmZMj‚Ş&yNš%GÙPas\rë‚\0îÙÜ\0bMAÁ.É0äC+#!™“‡\$æÃna˜:¸\0ØÃ;âªÁ¤:€A]SSç¬\0€1¼ID¦a\rìg,‚ D–	k¤ñk¡¨Eaˆ½‰Rä|ù*J„İ×íEÅ1oQ%9`b =e•…\0\0(,€¦!Ó’¼QÄC‚åPæ(².á€SÖ\rÔ©ÉjîÁ\0pA¤;6pÊë\rÁNé½ó'\0Şœ¬oõ„Ø”7!I`\"ÉK›Ó¨]ÙêÂÆ§¥ÔÕsgÀsO5¥ğ¥ºñ{C€uO	é>&FÃ@iuÚM†yXÉUïa…Ş†RÎ‘”ù¡<hÈ©‚X‚S\nA{1#¨L’Qí_¥Ì55ñ8ã±g¥Õ¬Œáec¨İÙ¤jH®H‚xŠUœ.%T®¨Ğ­Š¨.k´¸ºœE”-PSm\$¤³İ5—áí|Œö”0”bğÁœD´÷ÙFKKAÃäµL\"Õ&dİS`øDƒ/ÌM=ËÊG†ôEä ÊGµö¿áôpn„T(ğ¦0¨œUf›5#¼lê)J\r?©dXGaµÉ*M~ÔtÈÛ=%Ì‘1Lq‘Ka†ˆÉ)ÅMVö†dĞ‘ä˜¨¢E?RÖtŸ8F¾[òaUL(„Ê8PDH ÁRÔdDrx2º'ŒÄù\\¹•ˆÙoj©!\\YÄ½¯c©hı¦ŠJIwHÊü×mµ¸âFÑôæ,ê’ESJ¦ä#˜˜í¶?º¢z£9'¨˜oªQ‰II)Ñ-âÆÈ÷®èH§¦*5ŞLx\$YA¥É•p–=ºXÌÊ\0ëÛWfàlaŒ6_ ×¥\$SD_GÒ4)²2ÑôÆ\n:Š¥\"ˆbÕ9C×%µV²’s1æÇšq…©ùä´Šª\"\n…P¨h8&À‘‘Ú2¸m~ ßˆÃ8ŒİÕøÍŸ7«£~ÆÔP/NqĞ¦ÖÄ„·¥¦Ø uíƒMŸV^vI¼dı+³B!LÍ^4r\r½\0Ã%åÕ˜\"4NÇ,ˆ¢NK§‡_I˜Ì®Paì\$ê7.ä0¼M’åÊ[˜w®’yü¡ëvzW™RşA…1ŸÕºˆÄR-­²)ÜÉ³@ó·C‚/}Uöu53\$LZşp7x^=ŞKã—«z-['.R75#a )•xÃ×¾÷au°¾(,÷öì/¹F'ï¥µyNÜl4GP\$?ä‘È;>h÷»Z@»&Œ÷LğHh¶5ìç\0É¶ñ!F9N~ñ!HôÊxı¤\$eÈá\n";break;case"es":$f="%ÌÂ˜(œoNb¼æi1¢„äg‹BM‚±ŒĞi;ÅÀ¢,lèa6˜XkAµ†¡<M°ƒ\$N;ÂabS™\nFE9ÍQé İ2ÌNgC,Œ@\nFC1 Ôl7AL%ı\0é/‚LçS‘¼~\n7MÖ:8(Şr4™íFd‘J¦„x‰„ç#&›Ì†“1¦*rLç+Zí	¼oXË•.ËifS ‚{4ä¢gØÓ¹C¡‘cpÆt:İ\r'¨Ì*O{0ßdd}‰ÈÉŞE·ç!æ(o7-[ØNNn2Á\\öÔAj œ¤üH}CÉ2‚Šf5®Hl™\\ñœ¾S™9ãˆ§+/js1ò\ræ3OFF&5£ü‰¦¡~:5Løæ7¡®ÓZ8/Ã˜î·Œ‰ ·„3È·…\0ê ÃÃs[‹ó ¼¡îB'‰ü@›¨®+Z¤,ÚF'eĞÚ2²àPŒ2£ÍkŒ4-ã!Œ)¬DOPÒé\nLã¦2½Ã(è9elŒ*\r(jš°«K¢…Á¨Ô<9·²zHç-ï„ÒénD¯¥r0˜7®Cs¦Ş¸n;’9N…ŒŒ'£*s(²²»¤³£ò¦4`AG)ˆ(ò…-H…á gN†2;Á¿†g=:.‚& ÈÂ{|É1ÂcÒ¦1#KSL,ù%-8\"<\"ĞäºBÈ5¶\"\n\"Í3Iµê6ÉYÏõ\"ÎÚ#N…ÚƒL’‡\$c‰@B@	¢ht)Š`PÈ2ãhÚ‹c\rì0‹ P­¶/Châ?/ÅE¡cl>:àÂÌc`9/C\"ú#ÈxŒ!òG…a“ˆÜÂ¬lf/ŒÅˆZÕ’¤vâ×¤Êx!X;eÈZ—©1D7!Oüj“ £d®ø)Œë>ÛFkÓÑ)§4Î‹!Ç”¸…\r54ô&¨óTµ/0D¾›VÈR\$àJb½RCk—±iÚÆµ®wô’Öà!†T¦0BF*\rÖ…ŒĞÄ>µá·gƒ”;€¡é«‰…C3¡Ğ:ƒ€æáxïÑ…ÒOËxÎ²A}R0¹N@^İ{”µäxÓÅ¹Tè¤“®îğìË\r\$.\"1®:¢‘(í\"cu\nÂĞŒ&ß	Kl²²€Ó@?ØK[Ë¼Ç5ÎsİEÒtËWQÕuƒwX<g]E†	#hà‰GorÉ^ÊV0D!(*Ì‘àl€ˆğ”³ÃÀÊC(b2DèíÀpÄiÃI'7ä-²‚ŠYá˜@À8#ÆdÎË¡© X4ˆÈPpP­Œë–³|N#ÒPÄ É6¦ó^Ê5%\$-äÃ\$£=1îã3“\$CÚÑq&ƒt Ea@\$ƒ|/!` ˜(Xs!¥¤ˆ”ÕDÏ	Š*!h=B£Ti	§,Ky1™â‚ËÔ%M¸åA²Ff“yÅä 1¼ç kƒf†§äú\$NHÂCD\$éÂ^ƒ)BÍ	!D;ˆ¢ı!Š˜¬Ş\ni (*ğ×ÂS\nA‡b^zVP¡±šÆÖ³\$\nKîÀÕR6áduD¥À‘@ñ\$L¿•îøäŸÔ’öIy1%(‰‘Wõàd?«€!sˆñÄ±­© Ó¥\\F˜ëzdšÔzá°3©•Å¾çŒ±t‘ˆ††JÁDSÌ³\n<)…Dì!„C„ Å±\"jQÔ=TÌIÉI+!Ä:Ï2&‰P3ß’Ì¶r'æ@Y!;s¦i¢Ï”\naÈÁÄY €)…˜(êª€&\r‰6 Œ\"ñ&H4íÊƒîe)j%¼‘¨†~÷%	éDGøUã,KL„0Ë~®ÇºÎËÎÂ<ƒSUh?ÈzÌC4–­‹\\-ïëÉ¯[æ`!¥pØ\näi†‹áˆÆ&fi\$Fg8‹@¢~FÑ99Fˆ\nN9ƒ0¤VO ª0-IJ¾B*œa¯v¶·(¦M9ĞrcFå!2â D‹	VÌìŒÓø‰UÍiÁåw<s\$`áéáJ(–Ò©‚gh«Yˆ\n§*€:²d®¤3†¬»Û\$a²_îø6ÁuÀ“¼ß&v5§`Ş’\\@\n\n¾ˆ€¤rĞ‰’P!SJ¹œwôD@\n¶Š\$²×Ë]YÈ+O¸M#À¤Db(xª†9üá³ù‡¢í‰µ›‚úAB¡¹¹šÛ\$pĞlòT#UŠ¶\0";break;case"et":$f="%ÌÂ˜(Œa4›\r\"ğØe9›&!¤Úi7D|<@va­bÆQ¬\\\n&˜Mg9’2 3B!G3©Ôäu9ˆ§2	…™apóIĞêd“‹CˆÈf4†ãÈ(–aœÇL¦A®0d2›à£¤4ĞiÎF“<b&l&+\r\n¹BQ(Ô‰DÔÈaÍ'8Ó‚9á\rfu‚¸p¿NÑI9dŞu'hÑ¸ßµ¡&S<@@tÏNó¤hégœáŒPù9NIœ9á°;|)„@jß˜jC¦,@mš\"ûÙ³q†ßï¦|ÈÏŒîôFã=ZqFİÌ¶µ`ëº*›yã¹¸@e9­Rr!‡eX\rúlñÒÕ#ƒ“ü8+˜îµ/‚‚H:½ÌZhè,Ïò\$4Œ¬k¾Â§Cš|™7ã¨Äß©[Ö¾HÄ“‰Ã¨Ú1-iš¶ï5NÊ;:*êÂ‰-\"ã·#HÈKpÂ9B²B9\ra\0PŒ<B8Ê7¯èµ°\n¼0¸)x†ŒQğ)+iSQ\"KO<¸Æ\"ËDù# P˜7­¨#ÂBS†è;\näª°¬“ß+ÃÔ2A*¹¨ MQƒ¢Ğ<¢\0S<°\\”Øb	ã¢X2c@Ë«L\nÕ-`P 4#“\0*4‘špï2`PŠ£cÄ6!ã`éW©%\n´%#rq¶È£‰¬Ú»XC¨t/ƒr†Çâ@	¢ht)Š`R6…ÂØóu\"ìŠ‰º`É*ÌIÛï„àÂ‡Ã•N›=Ì`A!ÖCÈxŒ!òO}_‚Ş7Ëbl2àøL2#ËéA¶hÕìµ=ãræcã–.2\rhÜ–ağÕÇöˆË347ŒÃ2Œ¶¯ƒ9\"Nsª@R\râ7³ãk<„bh1Œh€æ3£bó:#˜XÓZ`Â3¡v3G»8ÊaJO#h\0Ù¬;ÒB7#-Êp“ŠŒÓÔœŒÙpŒá\0ƒy£†¶1å±óá|·ÃEü3¡Ğ:ƒ€æáxïÍ…È¦â9ËPÎÂ¡{õ‘RXx^İ;íÀb¸S©\r:Cİ‡àm\$£ëp ÙjëkK¦¬*–1#*N”·<\\ÄÉË¸ğ8V*Ø]Æ3<#Éò¼¿3ÍüïŒôH7t™L+–}ø\$£‚*Ã§c‹Ê­xŞ®5:TFŠ)>\r(Œ¿Vzb]«GĞÍ‘@@VšQyCÇØ£·…LÀÃ©=ÁÜ„µbé\0ƒ“}IT®ÌkY3Oj&%ª5fŞ[`ÙE\r‡0Â•A\0c_Åú†’HË‚)C(KI	¡PÈwİ˜rgæ•¢/™¤!f¡SÁB¸@P/\$\"#!sr’‰ÛjL9ºX2à\r9Ÿ„ÑšSªÉÌL?¬\r`ğîõ•Ò\re©µDVØ„Xø@roƒšj,`÷ø\0Œ‚@¯DrÎá™îMHè.Ã\nË6¡½0´¢ŒS\nAŞ ³Ü¯T‘†xaØµ×ˆñY*%(—¦†ÑH¡HhĞ†ó^Şº\nwç¸š13×Øó.	\$<™p@EJäs0†6DÅü^,_ÇÊ[87?\r¬9mæn“”iI8P	áL*ÕäşHÓJ“à…Cå„É´É•Ä|áªiğç¹v „Š€/ê4HØh\0´ÂLèef´ =Æ©·Àã|˜\\S\n!0˜2?\0F\n‘iy1‡âªØÁşœiP‚3ãàIÂYßMMÄ†XÊİ™pUx³>76êQ™pKZ•â¶L\\ÿ:s ”«1Ê:ÓPÅÙk¨¦ÖpÎ­HŸ'\$å£ÉP•Ã`+\rd•ã£rÂO©1È‹ğ}Œ…P¨h8d. ŠÂNü	RK`²şŞ™a!fL…SÀÊ‡ê1…Vá5ı†Ì@Q‹oHÌ’,0¦”Ì\"?9À6ÊÂ²×¹ç¬¤¬®dùY;+Ä9ÀàÚZÉö0Ö¾Ğ˜U0k˜§tÑ3²\$µd£?5–Ô}†0åÖ¢ğ–ÛØzº%v´XZ	,+©ÑšÈ+DŞBÃ.EĞ¸\$|Kí¤+¤„4•à";break;case"fa":$f="%ÌÂ˜)²‚l)Û\nöÂÄ@ØT6PğõD&Ú†,\"ËÚ0@Ù@Âc­”\$}\rl,Û\n©B¼\\\n	Nd(z¶	m*[\n¸l=NÙCMáK(”~B§‘¡%ò	2ID6šŠ¾MB†Âåâ\0Sm`Û,›k6ÚÑ¶µm­›kvÚá¶¹ƒ![vÍÉM@¡å2¹ka>\nl+¡2HîµÂ#0\nÈ]SP©U!uxd)cZƒ\"%zB1°´ÀC2êÌ©o\rä*u\\¤o1ŸºÂgØæ{-PÍÓsóéŒWã¤µ•>·--—¶#JìÜKËæÄê›<­Ö‹TÜçsüüF¡ÑT¢…Ì/\nS0&ã>l°`Q\r{US!\\8(ª7\rcpŞ;Á\0Ê9Cxä—ˆƒè0ŒCæ2„ Ş2a: ƒ¨à8APàá	c¼2)d\"æıêrÔ¢Å’>_%,r‚ş6N\"| %m¢T\$ÍŠS%©ˆæ¥¨êJ>B²M[&‹%ES’…<¬ªÀHÚPW;æÂˆ¹'ï²²Z%nºôS´,“‚ÍŒ+>ˆ'.r%!…›œú²R @œµÈ©bÌ»)AhŒ!¨2‚Ÿ³ÚtË>ˆã8²&ò\"”ÿKMLÊ5<²îB°PüÑ*“ÌÏàPJ2<nÑTÕumFÀ\"4‹úî³ÓøH…¡ g^†¬[ğÈ‘2ôXÏŒdĞØ²òÌ>2îìØ¦Ó]N•°Ë¬B%QTÃG’Ë Ñ¤£“ä²XÆÑqRƒ\$,¼£:NRb¢[2K²_\$jÎ‰!/½äÁ•UX¦®²S\\•'îÈ—V;;„©Î†)óz\\ÃN\$4l	@t&‰¡Ğ¦)BØó•\"èZ6¡hÈ2\\\n\rÄ‹H\nÃùUC#hê9ÃàÂ™ÃÊ:£”\n0ép@Â<‡xÂ%úˆ!ãpÌ4ŒúHË¨êr0@õÈĞ`Ò9Âd(™T7m;\\3·mƒ(ğ:£pæ4ë2:\rn3×œÎC ØÀ’Q\$	&ßb•k>ä4´Ú£?¶—b¢ÒS\n®\0ÎªôC@ è¥ÙÆFÅªl#Õ‹A\$d‹SĞˆtË!E¤ƒ0#®@Î±³;StDGAtÌ÷u¦©¿[ƒ¸=‚ÙRe|\\Ñ!ïÏpİ¨{T9(«Šëxİ'¤•¡÷²V!ø(*\r`×ŒÛv~õŒá\0‚2\r¯\\\0co¡¤2 p@Ğ\0hhÁ˜‚ Ğ p`è‚ğïÁpaù  ÎÛÈ/BÍÀ:7ÀÜÁ>„h9ü6¨¡“zÿF‡i0¢ÓlSÉz#Î8ºsÀdŸ›:EEFc`›\rzì.N¤Ã˜óèB‹£x&Í(‚âæÛlGP\"X „‚ZA§ú8.ƒĞ‚·fğŞ¡4(h‹ínÅ2öPÈì.QEdş=”rã\rò:+\n}0Ä¼åÚo%†yñ`PÊºd\\ñ<”%†HO+\rOg„†1·à…c„­dpÒ` HP8 wêƒheU„37€ä‡CcCÌ3YRxgl’˜:€A1P£h–0£@Pİ	CloÒ%;<dnèM‰åYÊ‰\"ã|Ÿª¥’”I¬™Šh \n (#9J\$i'#Ìh¢‚‚d\nRZMStB£‚âQ¹/kº4J'ñ1Ãx È4¦Ôå•\nD(e³¡ Ş‡&ŒÀòÉ)©I¶mÑ©A\rCÍ”zŸ‰|ŸhÍ†ˆåÓc@³\"™\0êˆ‘\"&J°;†€Òæ3ığ>U!JhÃ?´)… B[y›Êm(Ø¨Jâ±*1v)2T.MKr¨¡'Âxí’ÊU\"ÅX—ƒ:MŠÊKÆÍ2DrûJÑEPôÙE£8ç)ºygñÊ’CxuB°‹!Ä&•dÅ¢­8‡T0‡2	\r¯ê\rÆ‰o2(c˜NcÓä2ˆèÉ&ÅMR¥húÂØ\$ş+\"ÈŒUt¤ómb?e>òõ`æê¨;ëv|„¬C«ò9{ĞF-*äyL>gjàzÆâSKFæ\"Hë„~’PS\n!2Ü5K_Şas5L`©;by!—Nõ¥ÙÆæ¤+–'©æ>;²›XÕT4øğÆÆÆLª•?'RÀÓ\n0aä¾-`¬MÍÂŒT–HUgÃLEÅª<<lRÎ!'¬iğœG‡ã§ªÎYá¤ËŒFàtA°Ú*~ÔUŞ32%>‹ÀÅU•Â\n¡P#Ğpä‹3à`Ä<Ó_¸‰qf\$/fœ‡_Å£†ˆ1?x¬ˆ©4Â_S98“ISj•ÎÂ¹°PÂs“\0g¡t:N8âç”}Ñ‘‰(äÜg+¨xñŒ;ÆŞç!ŠÃ¶!KÌ£Å:Å”¯ŠÈ¾ijyÅ•°ªy2)Bá‡›&´Ê„¾Š8À‚B+S¸¢s&9¤Ã¤ÍÑ¤uÙTXå­xÍsC8ÀéÜUVc6}Ò‹™\"Îs+åûœ´–É5hÂ×;7°©“Y\$X[e‚å¸„Àsî‰{Œx¨‹";break;case"fi":$f="%ÌÂ˜(¨i2™\rç3¡¼Â 2šDcy¤É6bçHyÀÂl;M†“lˆØeŠgS©ÈÒn‚GägC¡Ô@t„B¡†ó\\ğŞ 7Ì§2¦	…ÃañR,#!˜Ğj6 ¢|œé=‰˜NFÓüt<š\rL5 *>k:œ§+d¼ÊnbQÃ©°êj0ÊI§Yá¬Âa\r';e²ó—HmjIIN_}ŒÄ\"Fù=\0Òk2f‘Û©ØÓ4Æ©&öÃ¥²na¾p0i•Üİˆ*mMÛqza¯ÃÍ¸C^ÂmÅÇ6†É>î¾‘ãšã„å‡;n7Fã,pÃx(Ea˜‚\\\"F\n%Û:ÛiPên:lÙ†˜äh”A¡Ü7Â–½£*bŒnû”½%#Ö×\rCz8—„\nZŒŒ#Sl:c›’Ù¨éÒ &ãä0p*R'©(åBƒJõmø@0³ì@š¹¸£L7E‚^Ô¥Îâğ+G	è#Œ£zJ:%Ï#ÔÔŒš`´#ƒN¼Œ8Ş—={Ù)\$ƒJTÄ3Ğ4L\0ê2 P¶I€à<cË\\5ÍRjî.ì@ª:ÃI»÷\0A(È×Ã¨CQ\r5.cˆA j0ÍÃËGÆ‘Ê>å	«Nø¤àP¥\n·ªJ7JÃ%>+#í;ª•£‚“1	‹cñ(2`P‚4¿HÓSŒ®ë_;¬pJ‚WÃY†[WH`ÒÓ¶³\\6YŠh<…Ô] R\r•©]ÛÓUn\\ëº´%#s×7	Ğš&‡B˜¦€\\â…ÂØíÂèZ&n¨@±\n@á¡\0x0¨ağäî¥©ƒ¿N¸òã|”âx¨† ŒÃHÎ–Œ¹EÆ0‚†”¼0ØAiAMil†5Øt #™¼½iÚi„)7t`×¢Y›\0¦‰X6IŠâ¼ Ã2Fî©Ä	E¨úC­ÌóKa6êc\r8ØÚ è#(à¶(#s’÷´Z4é-ƒtñ³4QK<¥ËFxR™ºxˆ³©edñãtc7%‰Â`¸/É£ep±[ja·¿È†æRn»¿(Ñ Œ[S¿O-‚jäN¼,èöq)ë@4ñ³]²ï(T?'ÊÂÆóÍB¨Ø…ïó×!D²:0E†}«ß¡g-`@ Œœšæ4­œJ(ÓâHxÑ‹ŒÁèD4&ƒ€æáxïù…È×¼9ÒØÎ®ázmÉÁAàˆĞØa-DTš¡’îjÅ#‡eÌŒ—|	ùÙ\rÇàø7€èí]jk&Î8“,Ü`‘!ñ@µ DfŠj.æ¤‰ªäH‰Ÿ( |á•ô¾·Úûß‹óïÕî—gğşŸànàø†ä5\0\nˆ8Ğ‘È&ÌjK\réd‚@óâh€eC\$I9§Pì[#)‚Éì†ÀÓ6ˆZ a; Ñ–Å\$e2®%è|9˜G\nwL90:¤ÀÉ†Ã@]Ş²!‘O8š¹¦o]|&-½Ü–pzÒù¬=îR1œÂ	„'1à£¡sÆ‚i§udİ¨=Æ€H\nLÃ´‰8ŞÚ((`¦\"'°z×yl4È”¶²û(yVAĞˆR*h\rïz¡+ äÔV\"\"1œRLÉ}I™50¤+&ƒğIŒYİ‘î×œ’rƒŒ¨y!¸×>2šfSªÓ[ÉĞé 4ÊmÑ)DQÎn0Ø…±ğz,s,“˜]‰€C\naH#Ó²xÑR9À^®ÓÙ)Pa4\r¥İÈL‚¹4!™*rl]É m.¡Î™1H]\rR‘4ë½p\0–‰ËA,DP‡´à”gºìWç±yLÃÙMc¤ò>MíÄS¸K‰¡±A\n †”I)s¬n>’Ò\$xS\n€µ†SRÙN(ØP¥fØ×0ÂÏÌ0s¨\$>¡æ–OCs)eh®=šyŞNèä’YX¹0\naD&5Û}\0F\n@9w\\ĞMôÎ\"ñvA,„äØ‰\$\$Dp£(4®JïXòˆ£“[^iiİ*%öµŒVtMa8·g 7ÀvîÓT98·«f“€—qRËÏ¹\n\nåRîJBL\r€¬Û¾ç]_•DaîTï@ä5oñA‚®yOrB¥dÂ¦À£Š\0AÖÍpß…®ø\rTÎ¸VĞØãÿ\rM96;\$Í9SGË¸e¢äà•Y²…0éuìš¬2qL:%èä×6òaï1{5†º¾›5Jw¥#ª¦Ì.Ç…K]‹Á–Q (ÓZª!q5xäÿe¡ïÉa\$:‡PpÜå¥)ˆ÷7Ä›Ğv5æÅ\r›Cbª¯ù{Ş[hèjgÎ?dğï»À@î%,…ÆÜ0»S€ÉùQÉÃ˜w_`t}ÏÁù?GíŸÈroô\"Pî–Ã\$b§²;È&€";break;case"fr":$f="%ÌÂ˜(’m8Îg3IˆØeæ˜A¼ät2œ„ñ˜Òc4c\"àQ0Â :M&Èá´ÂxŠc†C)Î;ÆfÓS¤F %9¤„È„zA\"O“qĞäo:Œ0ã,X\nFC1 Ôl7AL4T`æ-;T&Æ8Ì¦˜(2ŠDğQØÓ4E&zdÈA:˜Î¦è„¦©\$&›Ì†˜ôfn9°Õ',vn²G3©²Rt’­BpœÂv2„Ú62SÍ'I´\$ë6™N”èƒ\r@ 5T#VÍŞ§’MÙKáÏxrrBáè@c7Ói‡XÈƒ%‹:{=_S­LÈäû§\n|‚Tnòs\r<ì¦æ›Ñ3Œ6Î„˜Ü3»€Pªğ›\"L£n¥ÎÀÜ7;ŠN15¨‚hˆ»#s\$š´ˆƒ88!(»VÖ£pàÚ7¶‰ôF…ª P¬2©ZÕ°\$\r;Cƒ(ğŒ2 (\nŠœ)ª`çE¢pŞ6ŒL¢\n\"(Ãªƒ(c@Âa•Ì\"\n!/£L¤\nLØÊ0 PÉIì’œ‘B ò8C‘ªVùÊ²ÒÆD¼ô=sën1)ì.ÖE‹ük,»J4«!QÃ¥ ğÒO²Õ£)s¦Œ Tœ¨Œ£c¼TŒ“ì:A(È\rã0:5uaY7H* 4CsÆ¡xHØAŒĞ2¤Í’è4¨¤C+\ræs:JBJŠ6uƒYR‚›\$‡ÛË!¸V­J•¦:MĞ(\r&P¶&Î\n˜³<‹HòÇVÍÊ0Œè‚O92N¨İ}2AukWßÔ.›;)îTàØAR9¤‰uî2Ãî\$	Ğš&‡B˜¦\rCP^6¡x¶0æº¿¿)Ãº×Ã|6‚¨\0Ú:¹Á\0x0¨ó(:6ìÆ<0HÂ<‡xÂ\$š‹r\rÈô\0Êj:œˆ›)šúH\"3oÛÂÔ#Yê¡¦[›F¿Xm)Ü!Î1kÉˆ+<è4Z¼U,Á\0Ğ‹5ËÛ’\nhËQCì…LÂ&¨§WHI³\$*ØXêß÷ÛTß4ŠƒQ6\"8òm~»hÆÉü¬/Ëò27Á¼÷ABôNó_T@ÉÕH˜gZš¤Œ22­30@Î²ğÜ5¦Ã2,h\n`Î# Ú¦#<ü†&ˆÖ‡Á2ƒ0z\r\rØà9‡Ax^;şpÃï|š,3…øà^Ê“; ¼è\0ÇO	ÿk­P8’’PpLÈmÏ¸´djAioÉ±K1Å0’]#ÀtáÕ#3äPŠ”`s`PF	Š“¨ùÃCé}o´:>÷âüß«÷{æı'øÿ‘ò@n¡º4RH©Uf¦‘²NS“ƒBìô0‘ã0…Èá”\rÆÄˆ'€ä§ ñ¡F\\Õ6`ÒÛ™Ä*íØ’3t•£2›…AÈ“£ç6PÛL=‹È›0N0Ü”:ë‰Y0SN²)6Š©3”4*Pã³\\NÔä·4‚¦×¹O*'mvO›”Bs €(€ Aª \"ÁÑ‚\0PP‘¥)F,9ÜCNA%\$îÒ&ÀğjåYµZ¥Ú\$—Ã6i9JQ1—£Ò‹LR\$~‡nçd\$	*˜<´Ç°f	©¬-¥!’ØN¢Íl*`Å9‚‡c0\r¼t6l¿›ÈœuÓd*\$P7†¶8S\nA\$\nM¢/F\$²E¥ôÍÊ)gá°•HJ¯’„‚%ÄÁŸ†×,—ˆA;h!ÉB–(Td™%·`É£4²ÕL¶8Å¼o\"RwH¬M‚1&Ïv¾˜!S°`â%cXÀ[•¡@'…0¨J  ñÒ-¼€@šEHd¨PbŠ‚UC%•­­6RÈ=Y	=KH©¼9Ë.ÎËZ6óUJP hM¶5Ò\$÷îwLZ)ïU\$Ğ¦Bb##A*Js¬İŠVG+:UÚP‘)qIh¡ÇõPª ôŞbr¡-X¡‰-¦‰*®Õ\n™XÅ9‹#Ì&Ø­ûPSb¢§¶è0ô™«`­­ôJµ,Û0[rcŒ.ajÙÁæ SnÎ1W@ÍÆÒœXc@³ºÂ5'ë’6Èâ'İ³tÉ*(Ää9\0ßíM>LpìRF/=¨TÀ´ElC9„¶·Ît6Â°;†CŒFì±LmŞA\"°<ª\"£Ò¸ÒfäœÃõ{¦¦!Wø1›%ş}Â’¥š¤çŞô¡Qª#ˆ‚|jR<ğ7 îÔÒ!zo‚]i¬D†ü…à<&©q/CàÊª×{\0T/–[¯\$·XáJ³­kanLP5o¬ŒC”@s)r¤CÃ¢yˆötèc–²ç!®C˜—)…I8µó9¨åÚÌòŠÈÙ¦a>LÉ~…#R*Ê2µB¤4N¢¢ìé®~C'ØûŸƒò~İû?ˆxŸÛıˆ¤;‘`ÉC˜>ÉÆÀ‰µš%5`X.";break;case"gl":$f="%ÌÂ˜(œo7j‘ÀŞs4˜†Q¤Û9'!¼@f4˜ÍSIÈŞ.Ä£i…†±XjÄZ<dŠH\$RI44Êr6šN†“\$z œ§2¢U:‘ÉcÆè@€Ë59²\0(`1ÆƒQ°Üp9k38!”Îu“ÁF#N¤\n7œ3SuÖe7[ÍÆƒ®fb7˜eS%\n6\n\$›sù-ÿÃ]BNFS™ÔÙ¢Ê ğšÑÎz;bsX|67…0˜Î‡[©¤õ«Vp§L>&PG™1ü—\n9“¶ÛäµllhİEöœ]ÄPÓ’ÊqíÇ^½k£Á0óÍà¢äå&uíæQTç*›uC¼&&9J†ÕÓ¢³¨: ƒ¨àŒ@ƒ€Â9cºò2%‚òŒ#´&:¹«Â¸M2®­2CI†Y²JPæ§#é\n¢*®4«*ÚÌ\r©ú?hÒ¬\rËØ!Œ)ÃØ!:èØÒñŠC*p(ßƒ‘†V½‚ Ò‡4ÉÂ@7(j6#ĞÃ§#­.jòö³²3Æ!¡Œ\"€TØ7­“('élè1§á\0Æ„N­ÆƒÂÊ²'Ã£ÆŒ\0Ä<«@MGRàˆJ Ü¨^tøbòC„),œZ”¸¬Ñ)¨.ğ‚1ŒqH\nc*'ZHëèä´¥­Tp2B;D¼bÈ<CTR\n\"ÍKIŒ¶Ø«Z#L‚“ÒTmª0µPõ³mÄàPÂ3ÇÀP\$Bhš\nb˜2xÚ6…âØÃ}Œ\"íq]NµªÜ8Vp¥„l1ƒ\n–3m˜ä„¼!6ó!à^0‡ÉF‡ÎiŞÍãXäLŠ¡*[õ(’)„Buv]“ÂxD>À\"EÊô·H+?_´i\\?Î‰¬F7%ÈäÔ¨µüğ‘7š!£Øij!reœ¤\"š\$_£…šË\0&è¢©B°\nU Ã­\"%¿«¨­3»±µªN½£D›ïDŒ;,7íNÖëíÈ|#:Ç°Â(ÂêU²¢!EJk·B£ù4Ã4.ˆ0!•¶'ûˆˆ'æ3c0z\r è8aĞ^ıÈ] ôÊò3…ì\0^¢¯ª„A÷ˆş=Y.;9H#¬ş:âËn§¾¡°˜Í\nÂmŒøákœ-h“w@º´î½kZõ0Éé\rã¨\\ucG[×ö=ŸkÛ÷#¿vè.wï7<ğˆÌL<\$‘uØÃÎ#¬\$…¨¢ŠÉĞQçB‰ñ0â€x[2XÏYÉ%Ê›Iœ#DpÂ#Tcé(sN<Ù+Ğ@ÍR×…yÏ”Åƒ1Z8ïI> ÀÌg`ç^” ĞJÉ(Õ?²p¢VĞl\\­hÎ‘=HhÂ„ D%@\$ĞBAŒà ¥‚“ro	HF8—‘&Jš{(n…E>“RDÃ<?A\rØÓ 6,\0wIR+j¸\r0(LI¨«÷âŸ“iç|á²;pìLÃb]\\°ÌÍ‘SLäR|e@ëààÛrAÇ†„TÂCHgv*8ŠH¢©œt2\rá­´„0¦‚3(”â†Tš@´%8­\"…%³‘æòÉ‡¬(6&£ùD0¥M#h(M	³áTÄ]/'’…*Ÿš#mÀÂTAZDÍ%³S\0´‰Ú7Dø¡«V×y#ÎŒë§ÖÇCÃƒŒEÔ,82øb‘Äà4Á@'…0¨×²Ú‚áœóÑNKï6äu,Ò\":õ'ıqñèÍÃPì‡édEÀØ¹*‘84ÆvÄ4ŠIÙRL(„ÇÃK©,%ÄÀM“\n‚¤n:ÓĞŒ—VËD`™“iitü–™RÛ‰È#Ì€’pCy'UÆ‰(eªŞ	A‘­IMÇA:èŞS[Ğ=dD¶Û‚Ô±l0†kİdQ\r€¬1ÊÇÃ­#Ôı0È2‹mfE@èºC©…Fá?×¢B¶å	\n¡P#ĞpJ™ œ¤V²·QLån×9E²ŒCÄ~\"†M]°%|õcÁˆ=•âÛ*eR“åQ+\$ÎUjd€RJ1Êü÷S¹RÃz¡å&õPäHk Ğm¯!¤TcWk5mHÊøÂd(Q„f`Øø*‘G’(\n3|›\0¤’gLı¸Oğ82¨«rC\rÈ¸H-İXÂÓ¾-!â8«ø‹U s»Ø(Ö¶›²bH(T7§°#¬H`c3Äl";break;case"he":$f="%ÌÂ˜)®”k¨šéÆºA®ªAÚêvºU®‘k©b*ºm®©…ÁàÉ(«]'ˆ§¢mu]2×•C!É˜Œ2\n™AÇB)Ì…„E\"ÑˆÔ6\\×%b1I|½:\n†Ìh5\rÇš;‡* ñÂbJ—Á•u<UBkÚÓ0i›]?³F'1eTk‹&«±èâ†éG»Çä¸~_‰†&¢0ˆE®A¾dæú4¾U™Â¤ñìMæB”ˆ¥¢°i~ã¬ÍÅ•´\"U Éhn2\\+]³’í±[™´v‘GÃb¢Ò¥E¹®—‰ì’(”‚Å·MÆ³q¼înNG#yÈ\\\n\"N†„æe\ræS˜ƒºt‚N/àà÷c»Ê2<è¼Š\$\rCªÎ6ë\"ŒèiJ\$±\"Ék¦§'ˆ*V¡£*Z§9Ğ³w3ˆräk·(²@…s Æ5KâŒ%èäL—-LRúk¤‰{0Í¬Ñ<Z–\$±ì\$ë3iH…6QC`¯É0b>ƒ%©zZ•HhBÄè#dw-9ğ3€†ÌÚ_\n1¦»§“Œ!)„£\$±D\"™A b„œø Îƒ¦TÆn19	.\n|ÌÄ+©\"ôƒ:rbC@Ñz“¢Ä€D…­ÁÒ¤±D‚Š#,0ÍÌ²l.kÑIKS‹4‹\$ô’ “\$´ÒPãÕÓ	*ƒ#ÈRú\$	Ğš&‡B˜¦cÍœ<‹¡hÚ6…£ ÉBÅèÛ8‹#‘z\r£¨æüƒ\nzC(è:O\0Ãw<còã|óÜ·8†7Ã0Ò3İƒ-é{C!\0Òğ'¯8ˆ4o`Øø[ï+Â7aØƒë‰[ã(ğ:£pæ4ßƒœ\nË(írú9ƒb»Å	ªD\$¨±>Ø-rû8,Kj¾.0’^“¦<ª’Ô»ä,n:=^’¡bÀã’Ò[RPe\\.´Á.7m2¡‰{¡!Í	<ÇRJÈŒ# Ûƒ¼Z|lˆ¤…r„EÒ3¡Ğ:ƒ€æáxïÃ…ÛnŞ7<AsÊ3…øè^ùbƒ¦@7á|¬La;‡È2Å(5ISÊMHKO§(Ûœ'0Ë»¢JHÊšBU[¸Hr[ ¢.šHÔoĞË¾oÜÂpÜG¸<Ü#ÌcXæ=Ëó7?^Š13BZQôŠq	gré°:}nÕAHc®£èg¤¸´ŠCÊIz=#	jA™ŠƒCàC–_€€;†Ø\0b>ÀñcÊC*r!™#òÃôa˜:À€ØÃ;€¤:€A	Oƒ\r‚\0€1®ÈÇ\\°a\rŒˆÇb\"ö†¸£6Y(CF€H\n\0€ĞRjT[3_a¹Æ@á8oÀ9íƒ(g‚1LşŸV}ƒyø†P|;Á\nšÆ¹fh-m1UnH	!)ª°?ÓÄ|\"øa ‡ş°cÁ\n#ğp§ù\0  äœƒ¸h\r!6ğÎßàIğŒ0® ÊZZ»#8²¦nÎ!G®±^‰rğIN˜¡vE\rFº¥nC	R\"8 )‚fb ¹„ÒHA\$\$ïĞ°¡“”	“æi2–[ súAhAmÏ0Í2Ãrı‰+ô!„¶8³ÔÂC”HHd©Ÿ’#0¦Ë>W\rJVÖxS\n’ğ‰BÌbf)Fw\n-Z«6^D§Cê|Æjt%ã&IêŸ(åˆÈ:©Á3U ×TÊ±µ„`©ÕÈ×Ì¸Û›ÆÏ‚X1LÔ®Æ‚^›N9*:éñ¢8Ò÷‰)£.Ô–—&Õ¾Dˆ±ª1\$a¯’Æ¬S“©M’Šä¯éò€!Ê¶\\t	zeVä(;tc\rÉe´hê=ùêûÊ)Å%æ‚_>Êb\$f â J¶»3k3`£³S4i‰²Ú“\$Ø¿VózKI<³u&®ËôN¢ªÕ„Ao¬T â˜r¦ñ7¥Ïİh®Èa h´‰U£zYˆQ‰”r¢t*êQ!f\"Ö†¾šá&aÑy%fjÍ&„ÊËëW\$	5JÂ1lQ! #ÇLNj¢Cn5r}ÊuOÔ\r^\n2”º	İÖôwT,€‘";break;case"hu":$f="%ÌÂk\rBs7™S‘ŒN2›DC©ß3M‡FÚ6e7Dšj‹D!„ği‚¨M†“œ–Nl‚ªNFS €K5!J¥’e @nˆˆ\rŒ5IĞÊz4šåB\0PÀb2£a¸àr\n!OGC|ÔÅ ¤ÁL5äìæ\n†L“ÃL<Òn1ÍcŠ°Ã*)¡†³)ÎÇ`Â˜k£•Úñ56™Læ¨Ô†­:'ŒTˆ‚âdœ›2¢É¼ê 4NÆZ9¼@p9NÆ“fK×NC\r:&hšDÌ7Ó,¨› *müsw&kLšá°xt”Şl<7°c™„Ìêô³VôAgÃbñ¥=UÜÎ\n*GNT¾T<ó;‰1º6B¨Ü5Ãxî73Ãä7IPˆŞ¸oãX‹6ğ*z9·C„àæ;Áƒ\"Tı¿¯ûÊ‘…ĞRŸ&£XÒ§L£çŠl¢ŠR˜§*\nÀ Ãh\" È¢\$ñ\r##9±E³V÷¬/ñBØ­âCşa–cÓzã*.6.ğŒ51*e,\$HáZ8«{éÆr\\Æ6L£Ô¤¥–`P”=3È„)ƒƒ £kèÂCĞ@9H+Y45\"qÚ4£#Î“€M+K¨´Í61S\0Sî·À PHÁ iT† P–¸tA)¼I\"v7.lSê5ÁŠYB:;æ)bÕ¶¶ –Ù?ïâÆîPhÚ0¶€Tæ0Œ’ÃàƒC8ònêÈœ Í\\¶\r–ËëMŒ¶•©£C]Ğ25au5K]¶›hÏ\r—‘ytŞ·»=w_wçzCjËbKÀt8ĞÛ!cÎ,<‹¡pÚ€Â9;Cb/J2jz)ø|¢ƒ”0åğPÂ<‡xÂ%YFT!ãpÌ4Œãªwšæñ`@»Århá¶º4Ï\rÚcXŸ„~¨2\npÜ99èæ•	‰£´#lkJÓãí`Ş3ÉšÀ0C“VÆÙo¥úŠƒ{]i´A\0ë­£ÆÂc0ëäC:î9…ˆ˜ä<¤c=©iØÚ»ªpP9…,£Xvìè%B£S¦£6Ÿ6½Á\0‚Ğ.èg1ëÒJe\rBv3¡Ğ:ƒ€æáxïã…ÖÇ.¤A°`Î¤z-¨šèÜ„A÷¦Ş½Ú&pïïãXÂÈ©	ëj5[ƒ§Ê6®mE,ït5Kû¾şF\r|=WÀğI;DNà’‡vï]ûÁxoã‡w’ì`.yÏAëµ†´×ëØeA\$6‡jù£ŞhÆDÌ“pKL#GC„1¾„l_ã\$ğ2 HjÛ„zÈ¬räSÁO5n„8‚ĞN)ğ3DŒ1½Vz¹´G/Ä…‡'TŒŠ–!™ü¡‡á3ˆ\rî)E2oÍaİ2 €1À#Clkæ8¼º^C’Ï>¡8»ÇS\$ä:3AĞÎ)BÂœ‘dx\0€(€¡‘„y:  Ÿ¢°æDIS<\rÅ\"&ºÒÈkÍ‰³6°ùK!¦@MN\n\$a±‘räJ†‰nE0ÑçÚHÍádGÎ˜¸´rjIšpm“X]Óbh†(\0Æ#@wçœÖLhØSlI–2ÌTËS*‚S\nA‘‡¦zYL¹`¸µæ¥#õœ c0Â†‘©+%¤¼˜“3 SÌáéá¼ÈA+Á\0N#«!KÎgŒ„€é¤€ ’@ÃÉ¦‘\$šÔ.H±™8\$ì8‡S\nOC2\"N½å»yŒ‚\"’æüà¡Ø|éLZ9!¬‘ÈÀÂ¤¸7 „.:Ì!ÍqiE-ƒÌNYb;q¡Ø0­âBÈÔZhÅœÿ”³0w'Ëgšè İ2%±OC@L(„ÂJm\ra³\$*Hö`¥‰„¦'¨¼’Ò A%Û‘FÇ&[)l£ó%–WÒh¬LÃj–2)˜“ÕU	R›²‡ŒrœğµšRHä¦šO«³v–ÏZ‰2˜+¦!¤1ÓÈI* l¤Ğ…QÀÌäy*ÕÀ‚2i©1\0U\nƒ† í(ànöeK€äÑàê?öa]k±^®Ù»­>¼İ¢efyI\"„X‰\"àì³Q›0\$D½—ÔŠwÈHi·à(¼Ôz’’Â’€!Œ4­£¤Œ\"3?K9;Õ¬‚cÑ58P:,Aè)‚A”äÓÂ\n,Èµ/jÄP«PôØ}gaDî¡\01MÑ=ç\\Ş 2uÕŠybX9\"jgÍ	Ù¸§kå7u¯rÉ(üÊÄÒä«“ÂJÿ¡º-vYW ê¹X+èA¯°¡\rjä7-²ø_•º\re¯cêşÜpÎ ";break;case"id":$f="%ÌÂ˜(¨i2MbIÀÂtL¦ã9Ö(g0š#)ÈÖa9‹D#)ÌÂrÇcç1äÃ†M'£Iº>na&ÈÈ€Js!H¤‘é\0€é…Na2)Àb2£a¸àr\n ›¡2ØTÔ~\n5›Îfø *@l4Á©¹Ñ†Œa\$E8µÊS4œÍ'	½ªl­˜¤÷™dŞu'c(€ÜoF“±¤Øe3ÉhÙ©ÂtÆ\r›y‹/s4›aÆàUãU/†l'†ãQÖ!7n³S>·S«ØÎ/W«æÂ9“5í·&n/x\n\$NX)\n3 æâĞ©x(«6ÇçÓ‘¼å\"\"CîißšÇÄyÓ‡š!9œÎşc\$‹¢9:A*7;Â#I0èÄ£XæĞ\rËÒ|¤iRŠù¡(ÒÚ‘+#:>ƒ%ã:068!\0î…AmhèÉ¬¢jÁBSŠ;¢8Ê7¢QZÒ%\"m à‰ÄNØ\"ŒƒHèóB„¹‚š_\"Bj@:rŒ¦…ÇãÚ—¢rİ#i8ê£\"7#9ƒÊJ1àPH…¡ g8† P‡H¨Š^·:m`ª96Ëë¬:\$RµÉ,°Ò45£¨ä2€SÒÉÆ#¨È:Ò\"`ÂÕ\r0X%Ó­LÉ3>t|Hã±KÔI\"uÚ‘<.€	¢ht)Š`P¶<×ƒÈº£hZ2”JĞ3îb~ˆºˆ€x0§áõIÃ`“ÀÈxŒ!òEgÚ\"È3\r(­mÛ°˜@šÂoBò¸2÷SÌ\"wƒeŞvXÊ<BÒÉ\n=#59CdV0ÌBNÆã0Ì´\rÃ*æ±˜ —H©:7²Ûr\"Ï˜Æ1¤£˜ÍL`Ş3¦£˜X£CÊrŒ]—dÊˆ¦­°ÊaJ„Õ,°@5ã	:D*1I²X3^n£x# Úš£¹xÇ¡èAg±4xÌ„C@è:˜t…ã¾Ô'Z\"ó¼Ã8^‰…ït£¬xDnÈ{yt[ÍjJ4±+‚ó—ÕP,ôù¡iæX‘JP~´ü?Oåè<èÊşëkpÑ¯lÉ³mPï¶jZ¦à9n[¥÷~;ÈEh‰-S.ÜœÕ|Í#ÏZ%Öû£¸ò&:=¢,Œ8\\@%‘@Ò3hãC0Œ{Âp;²Õ;,é’×6œàZÖE’?9<I•eÜŒ4LjL‰2xãL\n°w`Q‹YJ9õÉ!@P+„Á\"©s’LA?0\0¿À\"D¸ƒs{-=à#(eŒÃã>¡È:ÃH|IÈleAİÍ¡ÄfŠ<\$Á¡ê‘Óips!Ì‘u“‡ãN™÷\$T9&`îhÃja±’ŒõŸ¨a:ŒI´BpÂ˜RĞP¤Ã0\\“\r¬€Ù†p@øCj˜S¥ÍKÓ.”Y¡µ\0QRÚ51ÎÆdŠLÉ©7‹çı\0 @ÒÉºíA\$‡“LS4(dMßš2X£Ãˆu\$¤@3XÆÔ[sZ~\$à1²©'Ñğa3' õ\0 Â˜T(ÄtÃG	1çŒ\n9¸E’NT!ˆK2à““Ê9,!¹r.b@á	ù…‘áŒØÖTN‰ÊgŒÁL(„ÈÏ•-Á*@¤ºÍQöxqOF(GIEKæL”‡&‚ªÔYÒ:“Æy¸EQ3çÄÃLA¦~#¥—?ÕQ18eîA*5é?e˜rGèÑ@CDìŠÃ`+”¡¤1²É6C²“Flˆ»ç¦Ì’1\"Ó‚4 øœ»¨TÀ´Pö®‘H¡\"fæÉ’ÊĞ£üé<à(#Ê¤DC+SXæ•H%LƒÈ\n7\n8‹\0 ¤¤&x\n>i|ç¤	\"L’{'„İ£Bp]R¥H\"ÔÁ Üeƒ„&´Àß6iæ=§ªº×zpoN‰<cÀ(Ğ \0ÖhØ ScUÂªªOË‚2ïeÍÔD¢ \$#‘u	;3b¡\r‚©ŠD*\nšu©éŞ­ €5#Ğæ";break;case"it":$f="%ÌÂ˜(†a9Lfi”Üt7ˆ†S`€Ìi6Dãy¸A	:œÌf˜€¸L0Ä0ÓqÌÓL'9tÊ%‹F#L5@€Js!I‰1X¼f7eÇ3¡–M&FC1 Ôl7AE8QÔäo‚ÇS|@o„™Í&ãdNˆ&(¤fLM7™\r1xX(“-2ÂdF›}(æu¶GÍ&sšá4M\"™ÂvZ„€ÂgµZ-‡(ÑÄëJ¹.WCa³[¶Œ;fÊ’ 1ÇN–³®Ì§±”Æ­g<	§ Äg‡JşÓerĞKÁDSd®×³&ZÌûĞQTç³\"œ«úH&æ9ƒ:ÉoÑS!‡W3G#ØsÂÑ©8LÎg{A’Lï%,BR‰µ¨ÓP‡%Èë&Ÿ¨J\"t¤©jh@µe:¡¨H\"=Î@´7Îc´4 P„ëÃBÊ¦B8Ê7¡±f*\r#ƒ&‰¢ãrI­£`Nô¡Ñ`Š½\"“º¦¡ñ( ı?ƒÈ2…#Ò^7D¢`Şµ#Ìàä™KJŞ²ÈŠ(2¥‹0J2ò¦3\\Û7©@R\\#€PH…á g>†(3¾ëÜÓD¢|œë¤î´X ÊÉ‚·3Ò+c¦¦HÄ6Ù‰íV³0+İ¯Ãs0ÙÎC-0É\"«]N¹ÓŒÙUS5mL4½Êp0¢i Ş	@t&‰¡Ğ¦)C È£h^-6ˆò.B³ŒŞº£Ğõ½Ì\"~\r©èƒ\n~4ƒ¢¼7cÄ0!à^0‡É5Ësˆhê.í´—•èŸl¢=Cn2æŒ\$‰M¾ˆàî«S…¾ªò5oÀél®4¤ÎÊ™¹r0¦2Æî3Í,WÉ6>9Ì¦ÁB¢¾ú²rBäİ³Ì9=7PŞ—%A\0Ù-­abÊ´Œfz„²Ô*á`s`ÚŞ\$ N\\7æ\rTƒnæ«^oœ¬™âõŸhv…2Ã.¯é\nûdò-iö¨cëÔŒ£0ÍO·­KÌ‚£ÆÃ\ré0¨ÈÃ^3-B\\7á\0‚2iòÀå¡<Ér&9\\‰HĞÒÁèD4ƒ à9‡Ax^;õuyÈ°!rĞ3…èp^2#¶ê:„A÷h¶7|eızÒi¤®\$UãÒ0èC¤İ¡c–¼ÉÓ'“¥/Êi&ÍŒ²Ö‘¿*1†T¼¾5aÌ„ŞëÏtIÓu¿UÈ-}o^¤ˆñ\$A#wqs‰#hàFSKKwì\0Ü#bŠËÉKÄ|‡9s\\fÌ\n`H*è&<CÅÉºe#ˆ@âFÂJk%)Uá‚Rx†¡B\r˜:°’\$Õ‰ÉgérĞÒí )(Ìlš Æi˜nJĞØ“V6ÅQGK¦â%3\nM7@¨AüA€ ƒ|>§İ\\‚\0POÁI*gÙ\"tÆB9dä=SîFÑ˜#%ª.Ÿ @÷à‚_0Æ¼!ÄÎ¬J†§T‰ÄT\"FŒAŒpˆ¥ƒZõOĞo{\nÂàÆ‰Ùe4ˆºAÃF y\$&¼*ğÖC\0C\naH#H#e! EJ¹\\3âRBd¸i5‘—£cpC°.@Î†`Â™`òjç‘‚1ùdLœ´=ÅÄ:Ëc.eÙªD0’§ëÀp,†N\\‡W/(\$‚\\—R_Ów	¥¨P	áL*L ¥\rÊól\"Ku™é”CÚ\\Ö/K¥š 9È¾ŒY^‘‰a€`¡8åü¸ '\$3Í°ÜDÉÉF\naD&M©¸„‚0T‹!•6´l‹rgóìŠÁØO`ALÇUÈÍ:`š)‘:&Š›:bCÃzß8gõ3aÎ\\Ó‡26â“OÚF0AÖ¤‘\n–q“mU5A¸„c%*N`laŒê†0ÖßA•å¢8ĞÚ^KÚT¥ON£R4DÙI„ğú¸ÂRB F à“'\"ÒJi4\\V\nÈÅy1biB¹dÊR HjË©)Ä¹›2ğ^«òÉdP6	€¤Tk”©„­ö*7+EN«…\\õ*G›gki¥4å0ˆÖ³HIˆ=3a¤a‹©ö©.\nTM*ı%Î U\rÙ2T¥4¯Ô{¡4ÀU†1a†Æ”H¤ÈÊ•»\rŸ©hŒ}¬‰~ÑqA\"FË©³–—;3iŒ]ß:…Í\0";break;case"ja":$f="%ÌÂ:\$\nq Ò®4†¤„ªá‰(bŠƒ„¥á*ØJò‰q Tòl…}!MÃn4æN ªI*ADq\$Ö]HUâ)Ì„ ÈĞ)™dº†Ïçt'*µ0åN*\$1¤)AJå ¡`(`1ÆƒQ°Üp99UÉ÷B…[“Hiˆ[½xŸ9Õ+«ŠA¡£°”´FCw@ ¡ˆ«Í~UMÀ­Õ”Ú^Œ_¹PªPU×!É ²•ÙF^Ç!• UĞœR<ƒÆÔĞI'2mhæK,/PÄ[™P©t¦Rù§W^°X¥ÎEúvª˜u:ÕkÂLç[&|	®ÏW¯~Gºë×*)Aåí¦‹…mÅŠä©4ª„¡TO;%é~s’…C²\\§10G\$%R­eK‘8myC±d~„©²\\¹„#¡%{A¤	Vr•åñÊ_“éLŒ«¢Ì(ªCe\$\$ÒÈi	\\se	Ê^§1Rºeê&r@I	FÆd	”	\n@Æ°² œ'H‘FÄº-:êÂ´@«Šò˜±œÄ©`ª’éy.RœÄÊ\\àó¡ÊDN¨K–œ¡,¡U1	)ŒdDK•ç)<E¡p†AÄF¡%U%J!1œ<AÈêäMåñSOÒ°„0AJpÓQ#Õ!ÊH¬DFADMEB8A8T!Y¥åpñœäÔk#heŠYI@BœäÛfÙJáÌD\0PJ2)AK—UŸgİ! b„è¥å!8s–…²]—g1GÒ²utÏåµøB.\$Y+nGI\\ÄT\0„Óm¹V¸–åqÊC—G!tÂ+µo\\œÅ¹vrdÂ›ªXÙÒ@.¡Cq\\˜ÄNYj_¡Óc*®ìÁÎGÅÊÌ…2ÏÒ_=Sù ¨8¶<ëÈº£h^2ŒD1Q—÷çáàÂ¢‡ÇI\nFÏèÓvõ‹ĞxŒ!ô^B1æ2,›+7¥Á(dlòˆñÕ¶\"gAPVÔñ’C+2É-›¾óq-ÙÎBHÄTAh)n\"C æ’\$\$IRaz¢q-a¢İ}¢İ¦KÛÓÌJä«Ìs\\ã1NÄ”h6ƒ•+L¡pŠ¤YœäQls²)ÔµéìOpÚ6\"*†TWOÃi¡%œ„™–3‰/8¸Sgu\$Ûp—¤r—Ì„V!„hè\"˜Ó9d¬–Ò<BË\rb‘aùNé^h†` †@ÚCpeI‰Dş*P\"k9Î5˜¡İD	K´RZ\n`„eŒ¹u¶ @eÀô€è€s@¼‡xŒƒƒhğäÁxe\rÍ|7†àÂLUàˆBNKÀ¥J‹².C¹	&¯¨Ù>rD‚UåÜ–¾w¦VÖÈ´€ÏÂ´,'‘\"!*í^«ónŠS œç*9#òB˜qª…Ü¦Ãhq¡ä>ˆ\n\"D`ï\"TQ6'Å¦CÀtŠAÎ,Å0DÛ!sŒBA|\"ÁLb ’7G	pÄÚLE\r‘,(Ÿ„(ñü<q”\\hO¤‰»×/ÚŞrğ!ÍÀ¢\\­Ìƒ.P8*'Ô§	æ©Nl¥q#»©˜\$„T-ÑÌ)V’.EĞ»A*Ò*GI),t\$×İ±ÑA@\$—@]…I¥øDRı\"dĞQŠ:qÆqW\nJ«<èâ\\9ÄH¹8ÈHA‰ÔN£˜›KÂ”ñ”'\$,G(]”…*LÊJXLÁóA3­Çe\nS„0¢”ö’™º ŒƒEDO&Cù`…Ğç)9ù	ÄIê…=…sÍ¡FhHiua~B8OQ6æ’‚2M\nµSó¤êìA)… ŒBTr£Wï¨–X\0Ï™´{›±ªuRªéÕ«‚¨˜\"hËÕƒ;#ó%¹‹cWL ”-)¨ä‰QDÜ–{Â›nf>¥Ò]`¼¢ud1›5C0‚+JòÀ;ĞêKƒ”PEoLa±¶ÈùQ©sw1‘L4xv.oP°Â¡	ljÕ\r¿+. I+õ~é¸¦İ¤2†Şò„EİQ`æÛ˜)•E»§\$år>½·~ğ¹‹UídİÓ~ş Ğ¦Be˜L9u’Á‚ PâÔF AbR_Ñ£ëE`\"›T÷–Ë/–Ò;ÒÚ_b°\rŒ%ËYl-«J}ÏÌş›0»­u²lİá¾8Å6ÜhÙ±f7š¦€Ñ\n\\eËã”@WyG´EŒ!¼ĞØ\níÃÈš\"	v\n|˜D\rÙÔHulŞD¼Ì3<\n¡P#ĞpRNÑ×Åêä¨\nnñ-.`ùJJ!cjmÍË<bLQ‹a‹À‰QåÌbˆ‰‘µŒôÆGR“™£8g¢ñ²Ëé<_è¹€ö‚™}Yreic;ŒªU5ĞíÌUÁ/Ç@¾#Ú¼ÒêÒC¬5–·>gÔ„ÜÅj.	y1Âs|BŠŒ&\$0Œàf\"ÄØ¨ÂáójIŞ‰ÖBË6ó0u*µNz6ï™Şyª¾—âg¾j€Ä¢}iK³ğ1\rüAR1©/n0\$C2ãâš";break;case"ka":$f="%ÌÂ˜)ÂƒRAÒtÄ5B êŠƒ† ÔPt¬2'KÂ¢ª:R>ƒ äÈ5-%A¡(Ä:<ƒPÅSsE,I5AÎâÓdN˜ŠËĞiØ=	  ˆ§2Æi?•ÈcXM­Í\"–)ô–‘ƒÓv‰ÄÄ@\nFC1 Ôl7fIÉ¥	'›Ø\"é1üÉUd Jì	‰”ş.¬ƒ©æóüeiJ‹ª\"|:\r]G¢R1t…Yš•g0<ÉSW¦ÂµÓKå{!©–fëÒÚö–eMÅs¹ıÍ'Im&œK®ÙœÁèÓ=eš×\"±r'š´¾›Q+ÚÅø’”„Ë¿ğÁü}„ş-ÂÕâèœî<“^ûï}nnZ,ó:ÏK<Õ©è;İ§SVè\"­z¼Ÿ©Ğq=oúÛ³*#Ë\0¶LD•¼‰“¦Î¶«SŠ¼ä:÷-JsL¶\"ìÂÔ4MÚi(N\".Ş@è9Zë7ˆËŠ“ÌBÔÅ´Ï»€´¦ì”&ëèªVŞál€7RR®ÇrÂ–ëF\næÓKŒté“-Y(ŠË°Kp¶DÉóLÎ£*ëxú#	“ÜŞ¨¬Š«Sj2S!‰’RÅL,˜âÎ*´ÊiìİDO/³­ºÈÛŠŒÃj\r¶1´ŞĞ§É—K¿Ôìï;hÕ ¦J1ÓÕñJR-E#ÑM;¬Ÿ¥-jÊ 'ôÒV§FmÔzâÃïD:¯GMå6Ò¼òŒˆ¬`›ÓT„ÓJÔO(H…Á gr†)“÷Qo\n÷DØ•\n3)Í•aûÈJ¼ôš0TµÙN©T\"PÄR’I(I[İ<S³m›ÂÍÁ4+”]‹g¢éM4µH!Òd­Xöz„ŒÙºO<:r¶š_7e!-dÄeˆ]×ò.Œ¾ùšRğªVÌ/ke¤ÃLñCLj@gä/¤m¹7}½¡t¼î‹zKo«‹­úO‡Ä*˜@6£˜èƒ\n¦C(è:Cp@0íÃä9#ÈxŒ!òc²ìâŞ7ÃHÏ¶»¾ó1NÜ©É)¥d·¼ÚZu@q§'˜¢ó+Š­-XcLÊ6C`è9kIc´ü&ö\nn‹Ê)¦5W¦ùœè…tvµ£¦Y…¢ ÷Z.ù+Äå´ë%-á_ E³î•µSğUk6Öö•íWSmxŒb–:ÁÊê*ÛºjÔiÆ«Ø5iİ½©¿c7:=y{oCM’½ËEÎ‹1#'÷”¢C mqA”9%e©•Ï?Ïøÿ?V”‚Éğ,uo‘hfæñBe*•²‚\0ĞÚC0=A :@àÁĞ/áŞàÃ`XrÁ¼9p^Cp/ü0‡@ÒßÁx\"ÎA¥öšMÍä#‰ÈÁÃ7¦Œn\"Äz‘9„Aåàƒ²|^ªÔµ—ĞIÄ„fÎ½“Âh¥!^eEyÙÄä‚K‰£·\"Æ™u‘˜ïÊğ“H‰¢@ÈöàÙÒƒÆ=¶@Ã	¡D*…ºC(há´8\rĞ2ÃØC(x‘\09Äx‚›<kŒ‰59«ÊÊ‹€©Š5W`{#µ:g¹‘ ¹­ áj;¦ÍËH£ªXJ*Î‘ˆ Œ¤âÕ\0JÂÃSíEÅÓqÎ¹ï‰‹(”I°˜IºøMQmYœFJªæËÄ~h`“²Wï6b’5c/ÙÚlMåÊ)/Ï9ö9Óè‚M¦‘Ô›ÁT”‰:‹kDâ¬´~n#üsfy*(¶Ë«(­<3ÀPTÁI¦WQü”²ÒW8+(!Ò;OI\0EŞ3I%(±P …–tÍCğ-ŠáÜPSaélÈ}ÊëÆÙ²®#1ot“½ö„LªbŒ(ˆÒŒW8¨KSMJ¦Z¢’2ºÏìÙA®\0Íck.i‹-•…’ŠLtßtÖaE¤0¦‚4«B\roøN£àŠ­ò36­sïXÅKörì¦Q¾°lÛ’¹â{]9^ÄŠ¿\nÂsÕ-5`óJÑLs¦H©¼\"åªl\"Z¹/Ùš<|®0™VIÈ—!jgg°­)'áRŠĞ££:pÇˆéd_ *MÀÒn²ÄäµYgÓ¾U~Å^)yk„ Â˜T\"¤dÚ•ÛQQS¯\"¯	R<Tısİ}€E).ô”	ĞüÊR³ G¢Ø‰°Nnıá¼s*óNØó>-2z³j¥š5BJÔÔè´.ş[EíaÍÓh\$Té›TşMÕ%\$õí(„`¨ u\n‘mZÍ%/ÓBPQoÍ’uuyÖìJumM¿•Úiu0&–T£¾vXä”{˜™	jÑ²µ#‰`@ù(4œvFŞA»Olïb2gd<Ç)ëaÊäÃĞ2ìXÀìB°¯ÓÛ/ßtÍ•¥fººpØ\nÒñ>øŠÂvËH½†L™c£\\;ŠÊÎÁ+~ÖE\nä\n@U\n•äe—pmASIÿ2œŞµ¾¸›ŞYêÉcÒ~e÷gÌnš‘+Ì¾5R½”lDT\$›åzX‰”èYjInÔd`êN\n¡¬îBİ±*ÕU‘I5Y°şI*³‰‘Îq¸¶B%¤0—Z)Öyˆa¹¨n1Î¥euT`Œú òÒ®bù/\"¼qÙ˜ê¼.L“D±^nèW›5Şr…Ó¸öSíàu§‰2[ğQvï¦mmnÕçn“-1ÆÍçÚgQ.Ê¨ğWƒ5¾¼‘3.ş¾8—!@";break;case"ko":$f="%ÌÂbÑ\nv£Äêò„‚%Ğ®µ\nqÖ“N©U˜ˆ¡ˆ¥«­ˆ“)ĞˆT2;±db4V:—\0”æB•ÂapØbÒ¡Z;ÊÈÚaØ§›;¨©–O)•‹CˆÈf4†ãÈ)Ø‹R;RÈ˜ÒVœ‹N:–J\n¬™ê\\£à§ZåìKRSÈˆb2Ì›H:ÖkˆB†´u®”Y\rÖ¯h £—ô™½¥!a¼£±/\"’]«díÛ¢äriØ†š&XQ]¨¥Än:ê[##iÍ.Ÿ-(ÌY”\nR—•ÌO)i®¥ıgC#cY¬çNwÏæôú¢	NL‚-’¥‚\0S0&ã>yZìP',ÉlŞ<V„ÑR\n£pÖ7\rã¸Ü£ä7IXˆ0ƒÄ0c(@2\rã(æA @9£€áDC„09ğ€È “\$«šÃçaHH­¤ÁÖAGE)x‚P¦¬ïºàv	RX¡¥ê3bW—#ãµgaU©D‚Ì¸=„\"øV3dñ Ób’SËÇY´·‡a6á'Ñ0JIÑ`¦ÎS «A\0è<òÌK±\$¡(v…ƒÿ\0•2ËbSM+ñÖöe‘v“b(¸–ìÙ:ÆI	ÔZÀv…å6ò\"§U:†1ˆÙZu•EKÈS‘ˆ¹I;A(Èò\r™hİÓSXA b„˜Î¥“˜A‘+áTT\"å”JeXå8„©{-­+ZÌBiN¯…Kf^/…› AJ'd‚u“Ì3ğ‹V«1elÉ²„—^7™i^WÏb2uİÉrò^GYÂ5,¼•L/êZ	.òÎNGYlBH*-9Hò.…£hÚŒƒ\"øÜ7TI× —EÔNÈ„\\ŒâI5ì>6£œD)ğ|9£ ê9Ac£#ÈxŒ!òW¤iBŞ7ÃHÏ§Œº¾³œi	\r#œ,6CIğAAƒvß¸Ãû¦ä2 Ê7cN¾9¥u¡RŠ]ƒ`è9,ÒIÚJ‡Z‰O´-S’vˆ±e4Õµy*¿“d*\rãx@6êCÈ@:ğ¨Æ1ÃÃ˜Ì:\0Ø7Œï˜æOÃ—T0ŒãÕµWİ;æ:ïÁ@æğ¼ë7ÏÍÄÌ.¡jµbŠ³‘%\nƒF¤5Ãã6é¢¾c8@ Œƒkç÷ƒ4ŒhA¤F˜3¡Ğ:ƒ€æx/ğÒúĞŠà½¿‚ô8İƒ£‚\rÀ¼è…+fkKœÍˆRœkUº¹jäHá.ö\\±*<…¡ªÅ8§énH¬}\$\$ š†ò}EAÍ\"ä€iiˆ½ù†êıßËû¯ş\0À0ï`8nA º@È&ßó€‚PQ¥Ú€moáÒ\r6ˆÄ@oWáÑÓ:€Ö†ƒJ)A®¢)àèJÜÄ&%A7&3h©#e\$Jª¥p[\\;%ou\rÇZø á¤6;PÄ†”r|AÊ1+ğÂ¡Ê#uÎÂ;7jíİÊ’q¡?„4Û£ q1†Â!F'4âš‡´J@PP	@K³¢\n	ğ)4©¬v”u	LNJe@‚4¨rZğnŠR=ò§çLi>MÀ3†U~‰ÃtCíµôE-İ¸wœÑàO#¡T.ÇXao9XH¹\\ÓJˆÁÍ;Ò‚ãDp\rÁÁäwC’¿á 4†0Ğñƒ;û^V¡ ÆZ(e“Ú|O @Â˜RÄhC.‘nDñ‘P¬RBÓÁ‡`£!Ìú\$˜ğ(‘0°@±t„©&DÑ9ò/Rˆû7Gì˜êÇ±5áQ><Õ#È\"‘Ğ¦@ñ#ÓàHy\ráÕ\r¿	ÚˆÈntQ´ÀâPò\"È<6¾x¢ü¨JnİÊÙØŠ§)+\n<)…CÈÍ\rjˆòBP+\rp°¤XósdTI7'\$î¯#bşkGP±ì7'1Mj¨Õ†±³øjPix \naD&¢ZäÉ°F\nB¯Ñõá—„D‰‘Z‘.S9sEıB9‚3QÁ›-+¦Å^ÙAªÍZ½1}ÏÍW¼­Y8f{‰g]\"ZH¦„[o\"ëØĞSÕ/ÎK	föŞXÿ|/•ÿ³€(!¸°Ø\nì\rmÍ¨‚\0í-ëÄŞtñ¨4†gUIXF’ˆi¢4j7B\0U\nƒ†êûƒ#å%xL{nÉ&Nõœ“^cÍ“ÓgK¬ßâbq±è¤,Ä|ü'CL}ÄAúBĞ@D¼;Nà§3¦Pö	'§“*M[¢‘†ì²X§#´œZT‚£í¶¬Ã¬F‰En#ˆa6Î–}aÚEQE+;ùı›™‘±Ë}3ìÒa\n†iZªÑl	3~,¬˜³^Ğ.g0ºW\\ùÄZ¯²ø ŒƒÕ\nòì\nê’Uæ?6&Hòj‹<ÍIárZkWYÓdhÖªn7YJ‘CQ ";break;case"lt":$f="%ÌÂ˜(œe8NÇ“Y¼@ÄWšÌ¦Ã¡¤@f0šM†ñp(ša5œÍ&Ó	°ês‹Æcb!äÈi”DS™\n:F•eã)”Îz˜¦óQ†: #!˜Ğj6 ¢¡¤ÖrŒÁT&*…ˆ4˜AFó‘¤Îi7IgPf\"^° 6MÇH™¥Š³”Œ¦C	‡1ÕŠéç\0N¶ÛâE\rŞ:Y7DˆQ”@n‡,§hÔøË(:C§åĞ@t4L4æÆ:I®œÌ'S9¿°Pì¶›h±¤å§b&NqQÊ÷}…HØˆPVãuµâo¡êüf,k49`¢Ÿ\$ÜgªYnfQ.Jb±¶fMà(ªn5ææá”är²GH†¦²tË=Œû.Û à²9cºÈ2#¯Pêö;\r38¹9aìPÁCbÚŠË±f™iºr”'Ê†¡¨¨è¦5£*úÂò?oì4ßˆÌ`‚Šƒ*Bş ¢ ì2C+ú´&\n¢Ğ5Ç((2ãlŒ²¨ P¬0MB5.í8Ò„¼‹Òø5´+*O+KÒˆµŠqÈàş˜¥ğŞ— ¢‚Ê‘\rC«¾À\n	ÓB;\$ğTî4Ï.úFµÂJ*PÅŒ*êÖŒĞì§@M!I##:3KR4˜è»CË>3\0PH…¡ gT†®hÊ®¡¬89£)*ÃJşò	‰(‚ŠÃ*¬9¤ˆ(‚:<S#È\"tF”2¡B\næÆ;D¸;\r.;È)ÄNÈç\\2gHÇ0Üv7\"ïq\\ë‚3X#7eÜY¸c\rãtÖp¾=°\$Bhš\nb˜-8hò.…£hÚŒƒ%«dIn È¡ÊQ\n\nšjO‡ƒ\nh8Êäú9cî0!à^0‡ÈîK“ˆcxÜ3,Õ¨Ë™f‘\$4ú&Ò`Ö.:Èú­-k-iy\0Ê<.ƒrED®ã–Æ# R)[2”°Ë\rã0Ì6-,\\ûHs¾/<OC;\0*\rèrH7!õZc>9ŒÃ¨Ø¸\rë>¬4ã–òä-â6­ªèaJ:%¥ZPşnü>Ë\rÊ Œ£hß¬ŠŒ£à”ÚZN´á\0‚2r	àåÄzÀÒ2>ÁJÉ¸Ã0z\r è8aĞ^şh\\0ö›Hä,ƒ8^¹ïbÒŠçAxD{Oça f®ã?Btá5´(”:QIŒëjEg[œì*ËCl»f5#ˆôüïPZ\rAçÔ<|^Ös¿\rá¼Wò^[Íï=è»g¨³ØjmU«†ç¼ÉÂHmÅ‡GÈĞ’‘¨Nf»ğ‚CönåÈ:6´ğ—HJé\raåbšujEƒ™8„AB·\"tG]I–!î@îFœb2ĞÄ9:Ğä””ˆaÅĞß·Æüƒƒ#nDóPiÃA–6IH3Œï%k& ·/¨F‡ÃHi\rå²:™u„¹˜CEugÃ¤¢—B€H\nv<\"º\n	£–Lä7È˜ì!b‚\r&p¸†rö‚A(5Fa’R6àAHË‘(i4çK;¦%Œp¹—QN2sd„·çjÀnIg Ä”ˆw5!Œ42ÌñT‘–˜´Ù‡6Õ*‹¡0vè0¦‚4,\"E¥‚\0„ËIk÷tk¼âEgLJÚQ.F¨¾ô`–NY\nÆøÂ®bHHT9&%Åİ§ÂRê+\rÅ´%Ó°‰ƒôzí%–ÖBI&D–;´‚f°nR& Õ`âLú	Çà6»(*ïfôdnkFƒTBdñ\nô¾@@xS\n’Îyã˜u\$”øQjˆÇhrİ\rd@%ƒĞ³Éy/©¦˜†³²ÌæJÀc}í‘ŸÈx†Z(\nl3Pú26ô*ª’,Õ („Â.gda*H¹Ğ†¡CTª–FØ}ˆé‚k’ˆ®±‚çÌ	ƒZp„‘\"ƒd,U“lZµj)Ô.²ä¡K¨Å‰@J}²ËÂÒK&Weª•‹šÖ˜ÅüÖ@ltÌ4†0ÖÕqÄ–”I—LKÃ3y;\$Ş¼2#‡4\\pU\nƒ†˜îjĞg#¶ÖÍ2\$E\n2œ:mp‹¾EWeÜ+©vó3ú„C)néE}Å’q‰s\"oÈ'0Ór@UKÅ´52.rF\nÜ<•Ôf£y}Wd²Òøä)Ç/Æó•bºNúBa¾ua4g%“¡,‰Î|€ ˜ëƒ¦—&”±bú&wÖÙ'MÉ%Ùä@’gÙ²%=8#ú´¯P¡R¹%Mä•@È˜e‰…ìò‘¼T`)!@édµÂ¶´‚J¯*Ä‹O ˆïÉtCÂ^kbèi~ÖÕ™QÇ%Û2,ECË";break;case"lv":$f="%ÌÂ˜(œe4Œ†S³sL¦Èq‘ˆ“:ÆI°ê : †S‘ÚHaˆÑÃa„@m0šÎf“l:ZiˆBf©3”AÄ€J§2¦WˆŒ¦Y”àé”ˆCˆÈf4†ãÈ(­#æY˜€á9\"F3Iºt9ÁGC©­Š¡‚›ÎF–\"Û6‚‘7C8õŒ'aĞÂb:Ç¥%#)’ø£‹D˜dHèoÍ±bÙ¸Èu”š¦ÚNŒá2šŒ1	i‹@ »›ñ¸ü S0™ö¶ıÿ†ŒMØÓ©Ë_näi2¹|Ï…·È9q#¶{oĞ5˜M¦ş·îaÅˆ˜t™Ï5_6Ì†Q3½¡2¯è€€Öb†)Vù¥,Ã¬HÊÁŒCØ÷%Ã€Â9\rëRR\$I‚Ú7LóüŠ£ãsu		jîıµCj\$6¨CšŒ–\"\nbf÷*\rûÂ4©åàÒõ0mZ å	ºd¯\r#Ö¥ ¢ö½Œ P¨bc\\…Ê7£(è½¶O«î‡5LhÒ×L£æ5³éì½-4\n(Bp¬šÎ3ÀP‚:i#2‰\"	€İ‰C”œ¤é’à£ AÇ˜DÑhàè4ÑôUIBRƒ\"àPH…Á gP† Pš¦\"„›ÎôC(Ä5¹¨p@îËTØ–´3õ[èûET;90¥\\ÍHi'TÒk \"ÂOr\n'<’y&˜B‚\$µVS)å[B7vä ¸(TPËf®ph\\6õÆ4Ü¡ÎÙÒwUÙq[×…!y½ÃJRÇãÈ	@t&‰¡Ğ¦)C È\r£h\\-Œø¨Î.Ø–5‘>šè‚¨ixê÷àÂ¡‡Ã”´æ¹o@A	Còã|”äÙ@†7Ã0Ò3¹£.i›E¨‹–¡À©Ã6A9\nõy1C™¢éùÊ<ƒ(Ü™ç‘s‹˜ĞÑØÙ-Ó0c’OÈæÙ£‘¡&”Ši\"L½ °ÄëkKHBìP½tú‹¯±CVq½É	R\r®Ôj.3­°òÎIŒwŒT7[‹%Õ¼k#N÷¾¡é\0¿:O	Ã\"G‰ñœq'ÈOòÒÌ‹ò´‡/qZ|Û=½U{÷DIğ=/‚u4'Õ²\\oÈö\\ŸkEv÷ws²•h‚MÏi©WÈ\"#ĞÏ0;1§\"é†½8\rŒ²È?Értô3ğè@ ŒœºIöË5zóFJKƒC*Àô€è€s@¼‡x˜ö@¸½p^Öxdg†4³À^ñú2¨qÁ´6noË i6FĞ\"\"â[Hiˆ9¾Ã^Y	‹|FÈåäfSÖ™%!5z@Zâ‘‰4d,9%Ÿø €!–ÀX`\\\rğD¶’H( ´jíe­ÁĞİÙ@I\r¨”2¥İêZ„Ä½6dZû	»Æ>q5í‘órñœIf'¸¥“>e›„)L(1!Xˆpb[„D²*Îc˜’<X	A¦(\\„¡Œ—B.Ñ§§¶lË3»sÎõĞÃ÷Ëˆ1®(”0¢w„µ:´k`€(€ bMÔŒAëtÇGX‰0¡pHª6‚\0PPÁLJ1ÜØ'Îl\r‘f/gtµÔ÷3CzY(°ÅÃ€%\$Ä€ômø›\$4@‡ Èõ‹Hi„¥8!F¦ÚË£‰0h@ç—ØxgÄM#~I-çVxgY•”Áœˆ0¦‚1¸É±­Åî¾]f/A´±¥fDƒqeD%Pæìdº}&\$Ìšˆo«§RO¸’öÒ1Eô\$5‘Aô-w˜FZB™%É!|I£á¸piAÓLæıbèr}†9EÅŠI‘h\rˆğ¤ŞĞ'àO\naR:HrÉ*W=Sh¤ˆK0Ô–KÇ-N²('uÚ²HÉ00â²×d°„H•R6uQáŸñ™ã>h4@–ÈV‹II_f\$ek‘S2òøS\n!0Â>HI%\$çhİ¨¢i8C”@#&}¨UœÇCÑd]&nÛ.C»3~²'YNá÷¥¨a\rå¼D„‚¦k¤ÜÂ9s”šñºM…u]bş¾nÕ½¥¡0°>û¾]™¶2p:¾ÇßÍĞCKa°²ÌDëzR•b„bzZQÉl’2L*…@ŒAÅ\"ÂM\$/ç™%Ê@Ò K«„/Y•P¶Ÿ4]…í…²Ãj+\n›2R\rá-šUÂj­K½viHW3)2‘2e˜\neFZo…‰sWé'‹tÈ+7qËÇmháx|^¸Á=µ\"‚‘šLÇ™¼Êd,úË3èäğ]NHÌˆ2 ôdJyÈd“†*i3jÃ†˜:±’.ÆÒhK>%»Reˆ[®Pê)Yód2™Å ú,âªÁJq%*a!X˜[I\"ŸO®(Å8« D\n8;Á\r# ¬Œë49‡rô#@sÏå\"àÖÑ©r¦¸àˆr!0.";break;case"ms":$f="%ÌÂ˜(šu0ã	¤Ö 3CM‚9†*lŠpÓÔB\$ 6˜Mg3I´êmL&ã8€Èi1a‡#\\¬@a2M†@€Js!FHÑó¡¦s;MGS\$dX\nFC1 Ôl7ADtä@p0œè£ğQ¬Şs7ËVa¤T4Î\"TâLSÈ5„êkš›­÷õìäi9Æk•ê-@e6œ¦éQ¤@k2â(¦Ó)ÜÃ6É/øùfBÂk4›²×S%ÜA©4ÆJr[g‘›NMĞC	´Å“–ofˆÖÓs6œïø!”èe9NyCdyã`Š#h(…<°õHù>©TÜk7Îû¾ÈŞrŒ‘!&ÙÌË.7™Np³|+”8z°c˜î÷©®*vŠ<âvhHêŞ7ÎlŸ¨Hú’¥Á\"pŞß=ëxÂÃiët<(ĞèÃ­BS­Â’V3¦«‹#Œ°ûœÃBRdÄ+éÎ3¼€PŠ—‘œŞ®c„…\"!€P–ù„	ØØ„0B`Ş–¹+ø-K‹òÌ&£`\$¹éC:A(ÈCËÍÓ„äıIPÆ¤@PH…¡ g@† P‡I|P†©¢)ºL˜\$'\nÚF·\nJÚâ¬äÌùG”€Ä5£\\¾ŞHä•ÒiXéÍ³{ 2¢n|—\r#E]£/²kU­B@	¢ht)Š`P¶<ÙƒÈ»F¡hÈ2TÍ6—>skö“,A\0x0§áğäç£“v›DuXòã|ŒÛ÷†´ŒÃL‰qİ—r|ıµ7ÛâÄ>ƒcîŸ„x@™`8÷ƒ`ƒ(ğçÉ\"ÒÄ£XEV·\r‘Z¶®®o³t–ã0Ì¶Ã*2(Vƒ\nU,Ël½h„K{¡+BkÛ¨‡ÉÃÆá3íØÙ–Ë¨~V–¢¨¸X‚SKv½Ê¨³,œ§iC’¹Î£k`:#3]+Äsƒ º¥HÈ¨è\$«šj’'¬Å€¹³‰d ‘&ÂÉ«d£–œ³y´hĞ\rÍo„EÆ3¡Ğ:ƒ€æáxïÇ…ÉÆèèÏxÎ¦AxÈ´¡#JÒ„AöÚ2:	\rówâ© A['’¨êÉš:Içó•1²ÚÚŒÊu~›®7c­^õyJ{+öu¼¹ğC/	ÃqWÇr“SÊrÜÀİÌaé–%í„WÆ†0=8@1Äz£öĞ´{hÏR§L¨Ù\rë2X›>İVs+×	ŠŒb\rÜ0†2ŠZA\0wSDL˜¤äyœMá„3ğäA¨cgè9†`êDİªıAĞÂCî„Lãç\\n‘¾—ØÅrB†ıû›c{\r©»\n (”fA?*à´?bZŸ\nAJ)ŒœëÃt,nÌÁ_@Pø–òÄILés‰\nà˜“8¥ŸË«(ÄˆŞˆtº@c¥‚\ršów	£s°+å… ˆHc'­X3¸v¼êàç'I“÷êL\0C\naH#F#„c0 6h-]7Öº|?WÄèË°ÎlNóI†¦=ºÈö­(bW&Y]&ö‡´’M&1ÂjbG¤8¹’³È{î’ª¾³–è«É±°[7''İœZxN½À“¤˜nÍñJ@'…0¨ñC“4kÈDø\0–Cš9„åß4&Qe±	9‡=W›UüÆÌ(o`Qì„¢Cˆòš’AD&EBZLg!f†X#Hz‰Í¤SSÄè:™dœNÙYMAâ«r^X	Èm‹ôl”JepfI¨5Ti4°JLKÚ_N¡¥4Ñ×[•!ub\r†ÀVËhcgÈÕ³,û&	5\$åĞ#9ÖÃQH&”³\"pª0-e:˜dKÃMMajÔ¥6Ma®‹dÄ96ª¦Xà\nm«•Iƒ…ÀS<8&È5^ğN ©=ºêŠCct KDá*Ê•r¶z_\räàÔ†uZÔUa\"Æs»¤MŒÁöJçFJ«àŒ+cJ¥M¥&~`‚)#@53™¡‘….m@Ş—BìN‘í¿LÇ|ÃRôëU!ª`";break;case"nl":$f="%ÌÂ˜(n6›ÌæSa¤ÔkŒ§3¡„Üd¢©ÀØo0™¦áp(ša<M§SldŞe…›1£tF'‹œÌç#y¼éNb)Ì…%!MâÑƒq¤ÊtBÎÆø¼K%FC1 Ôl7AEs->8 4YFSY”ä?,¦pQ¼äi3šMÖS`(ešÅbFË”I;Û`¢¤¾§0‘ß°¹ª¬\n*ÍÕ\nmšm0˜ÍKÄ`ß-‘Zã&€ÃŒÆÎ™Ï.O8æQh6çw5‘ˆÖéÊm‰9[MÛİÖ¿5©›!uYq—ÓæoÁEkqŞÅÈ•5÷Ûùˆäu4âàñ.Tˆ@f7N’R\$ÏY´Õ8±C)×6´,Ã»BÑéèä¦)Ï›\$ó=€bá6‹¦÷£Âh9©Ã˜t¢jB”‹¦È£^¨K(É²H«È¾£¢X8- Ô21‹b(Ã¯CÓª,ƒ†7 ¢rä1kûN§®ã,ó½+rt2¤C2ô4˜e[ˆƒÈà‰B(È4‹´—ÉÃs^6¬pé®Ñ ‚‹\r¨bDåˆHhÔ¹Ìüä	Êpê;¨(ÔĞ£ò4\"#CËƒPÂ/lˆH…¡ gJ† P´—¹K«†9+è¦»#Q,è2ËnH Œm\$¸%Ã2èZĞ\r+è¬Ş î+8GRdì;ƒ’Öª¹tPËYÇCc„·OÒ­D£=h6(tı›b\$£pê	@t&‰¡Ğ¦)C ÉY¡h¶5]ƒPºÉ*I†Û.UjÜÈ¨¡VŠàÂ¢‡Ñ,\\9&­€Â9TÈxŒ!òK`©)ã¬K…á°â‚š¨©(¦Ñ+m•|½\n‚ì‚da^PÎ47 wÊô’‰ˆsøåƒ äÌ3Y0Ì3!«Ş<·SõXÍ8“œjá¡{ãW8mtá9Rôé…\0à\"Kp@7ìşˆ¯KŞ8Œ\r«ĞêùÀH¨ë/šsä§j.v2j«Èİ¬kZâÊãl\0001l®\r´ÛI¦<:Œc&9º-pÍ=i)(¨4\"ÃZ†ø8Ã¬1½„ÉÄ-ÚÈÆªC-ú0­(Ì„MèÜ‡Ax^;÷rCÒArì3…é^2*‰˜Òªá}âLÍ&÷ŒaÌÅ\0Û6ªrƒj­Èü¶’ú¸kûı@9Íõ92é;øã@M×#ÿ´«u}hË×ö)ÿiÛw¿tèËÑnwÁÉà<\$*…Ş8ny,\0\$†Ò<S‰›oï@åòœC h\rç¸Ó  ªMf*\0Ğ¦†õHšú%äÑšHÓ8 D8Ã@Êj¡sÖJ„&¤KáŠ@ç3Aâãs\rë)»>‚k ¬7!˜÷´“C’O^)\0’—óƒÙjJ‹ÄÔ˜¥ò€H\n®B’\$ÍéF¼ã‚Š\nI*Áp„]«ÄHèZØiÊÔ˜ä®Ö4,(@€ÎÂ2^BÑ\$¤2—‚7’am‹\$.-¢€Šq¤‰P2aÌÙªæ7Ÿj~\reÒmc‰Áƒ…Ú²¯\$ÛÚr/\0€!…0¤‰t&Š6³ŒZJƒœ%o}À>#úÿ‰1(%H¼ç\"¥–ÒN	D§¤ùÌ2İˆR\$¡jsRFáÉ‘§4ºÇDï\0b*,2æ²L[¡œíh0·§Y=L	7L”Ë…\0Â -¤Uë¾bvOfêÁ\reÈ½EĞc‹ái\r\$b…ºÆ`²Ã”àôY|ºpÜÅ³Æ¤”Ì†³`dèy>L(„À[ÉÁ#¤|œë0Tgd©¹Ğ´XÛ%>IBJ‚¤yœJ¡T“Ê¨6ˆ*¨Áò˜Qô„•E& Ô¥É³\"¶²¨\"‡VkR\nlè6º&z_\n08(	ƒÁÃQŸ1H†\\\$jpRáQfŠT*`Z€ntç«Ã(hød‚¿2ê(Ê‚FXÃõ9ª¬´¡¯i^2[Ei-2—&|óVkJô«ÙS*²-Z±Ë-°4hˆe* ¶Å&:ğ{š	÷0ä‚v¿_ÍU|ˆošªC3¦IBk‚§Ù“&”›É­E¼ÆD(OÔr\\Qü;q,¹Fc(DÃ«9D`*ÎëPeL‰·KØâ\0 ‰NÃK-Ét<5[KR@T\rÁÊ”È©²Øph­fØÆÂ‚•ªTè”å\0";break;case"no":$f="%ÌÂ˜(–u7Œ¢I¬×6NgHY¼àp&Áp(ša5œÍ&Ó©´@tÄN‘HÌn&Ã\\FSaÎe9§2t2›„Y	¦'8œC!ÆXè€0Œ†cA¨Øn8‚ˆ³“!Ö	\r‡œ‡à£¡¼Ú\n7œ&sI¸ÂlMÆzœÂbš'Ò‘”ÉkœŠfY\\2q¹İNF%ìD¯L7;Ôæg+µš0”YÎÍ'™ÜÎq›H†¥¡›Œ“16:]ï4é0Âg™‚¶Ûˆ©ŸHr:M°ºqÎÿtÜîõ†ı÷é†¡B¨û­¼Ìå‚½JğG–œÖ\n!½ò©¸Ön7èSƒ•¦:D0ìLQ(YŞeÑú9ç3¬^Òçæ;­#\":+(#pØµ¢a\0Äñ\rmH@0ÉjôÕ&‰²iò€¡#M|:	É(ÚÀ¾(@æ\$ãHÈÁğ-¦LÜ‰Ì è;'ø2¬Ì\"ÔğB	Àè<\núã§hÏ\"<iÂÜ;\rÀP¡@­Ó˜ß-²¨ œ2HPÜçbÛ.+£\$<¢€LÛ7¢ˆ(Ô0HPÒ°^\0H°Iƒ¾4ËK<6³I¨èÁ?ì¦5±o0Ê	˜É®`T6Iâ(Z8\rè˜#1`P¨4¥i¥<¿/C<ÁµSdÜ2Ôl42tå[×(¢s]×³ËOL	Ğš&‡B˜¦zL-´ö©JÓ‹µ}@Ö¾3Âv\$hx0§aó.:J'	¦Còã|Üw(†7ÈĞÏt·…å0ĞãŞ£.ëÖ\0Ò¨8*o´¶øÊ<\"ƒrE|DbbaQæ%Œ¡jP6£B`<·\"ÈŞ¯.XÌ3SŠcœG¸™-„­*\rã}ÀÉÍ(Cø1ŒoÀæ3£`A2­˜XĞM-¸Â¶à3˜Ú¶æÃ(P9…(èª:iK}\rƒ`ò¥Ø¢ ĞÉ¤-şj‘.a\0‚2jhPå¥Œx¤\\¤Üa\0Ğ™ŒÁèD4%c€æáxïÃ…Ìfâ½­#8^ …ï²Ü”_xDrOŒ^`Q†L\rn~l6&ƒ„ÔL™¤º İ8X¨ú9TrÀå[§=K^„Îö2ï»ÿÁğ¼8ïÄîo9qÜ†ˆâcw-r‰#hà½DóqÎBQ:ÊÆíVøÌÒ¸ƒ8Ô˜5Œl02j\r‹Ïô!j^\\U·ˆ;FÍ`æ¥¨dMÎÄR‘ÖÌBÃcr…;’”BÒHr|áÉ¦àÂ–­¡4FŒÒ„\r “™¢Q8 gù’ŞˆË‘t(LØ;7rj¥á‰uB†´Î‡B`«_ P	@ÃHl†ˆX('`¤¡“–>úŠ	tAeĞ¯s_’q'gGp4ÃUb_ÿ4e¤&ØOI~kAœ<†ÂşÛRë]IÍ²	™ æ—Ä3F²2€Z„d,¶‡lìw`€;†€Òá#SîÂRÃu&Ñ®6Æó|Â˜RÌx7ò„ê¢nuïü5S\$adP\rÄt”RHIŒ™±l\$dšD¦Pƒ{1ğ±Óº’ƒĞj†`EÄ‡–NkQte\rçì ¦èG	˜q§àç†cÚI›{‹‰Æh¡4ÊM¡,d@1QSšR&iC\"İ{¡ò’ål¯x	.M™âlg™®ifÌœÌ§îLÉu€ˆp†µğ¾—AH¿“7CL!ï+Á­u‘ŠÈºää)…˜HÓF†±ø#@ ŠÒãÚR/´ºÍèüMƒ“16€()ÂêRC™Ù\"‹šè›H„ÿHÅğÆ0å†|Nz]#©ÌÅÀ3O\rC‘Wªı5Òs*ÅZŠ¨Ä6°Ö‚Ès°8…Õ˜—öÕZÍU4–j¿£Pÿ¼„T*`pÇƒ(g<Á¾OU4İUj9#T‡¥ÕÊªRJMŠ¦k%®²ÀBÛt.Åá°”µ\\T»q”Æ6J\$¾	Æ0\\ğ3Š_­X-BóĞ…Á3Lj&­r5óİ†švmj'+‹tê;sİÀQ\":a š²fa±¨jÚ®Øê|uÂ±oê<%¦TªI\r‹Qïfñ))•?ãôö>TU&ÃO.½Ÿ5fÁ\$P";break;case"pl":$f="%ÌÂ˜(®g9MÆ“(€àl4šÎ¢åŠ‚7ˆ!fSi½Š¼ˆÌ¢àQ4Âk9M¦a¸Â ;Ã\r†¸òmˆ‡‡D\"B¤dJs!I\n¨Ô0@i9#f©(@\nFC1 Ôl7AD3Ñæ5/8Næãxüp:ÒL £”ô =M0 Q\nkm¦É!Èy:M@¢!¼ÈaÁİ¤â‘–hr20Ögy&*ğu8BlpÆ*@dŒ™oæ3Q¦xe5^of™!hÂp¤[î73qä®Øíúi¡¸èy7pB\rçHÄLíõû>\rˆ¯Òy\r¯+ry;Â¡€¢©Ìë¹Ó\\òb†@¢t0õ.ÚÅ\"ìD)“*a=KğûS¢Š†ãæ‹£;†A*ä7·N@@ï—ƒÊn)ƒ Ü2ŒèÊßMĞÊõ¬èt'êˆ5BŠ:’¥©¢pê6Än3Şµˆƒè—´Ãò‚ŠŒr’7¤K¨Ò—PØ)¡‰¸#Œ£|h:K˜*#‚½\n0	£65Œ RüÀ\rã“¸Ë²\"ò‰R.7¹C`ß5#˜Òä:Ã\nääGs¨Ê9SÀ\"+Ìk2A(ÈŠ1 EQƒSGÑcÉàTvò£`PHÁ iP†2Xô:ÌÎ2Hbh6&,t—2°,˜4®C¢¶®Ë!Š›ë8ß0#óZ•#cØ0°ã¸Ç0È)]t×>d,}5/5~ˆ0b¸ó¡Iõ2Øã\r’6õÀ²EËd¤wM¾‹Ü7k‰w¢	 é¿\0P\$Bhš\nb˜û\r¡p¶9aƒº\nÂ³èRÖŸ„jÒÓƒ\n~C¸äÉsºqŒH€ÆäxÂ\$˜î>)·£0ÓL[—Åša¤–õ«g¡\0Ø:ŒI†‡ñõéèZ_ŒhúLRVêKl6Jÿ}×á\0Ş3È„6’\nqE3[Ó”è‚NîK\\ÏÂˆÊ6:¿n3üÌ²ZNİ\";CX‚o…˜ÄázÈÍ¡¯Íì¹8#£‘tnc&êÿïVô‡d|69ğ—9ğ¼;SÄñhÚá©Ñ|€êßò×/»ï/ï9¾óğë³ÑpœïL‡qSRÇRpé ;ÿvŒñ#j,M¥¨bH\"U®B\$¦yİ\\'4wj0‚2rç;8¦:\rhÌ„C@è:˜t…ã¿ìYŸäL£8^CÁy %ÁĞ4¸ ^ñ GgL³¶`’Óøj%áÜ<†tÜƒùmÇ\r;!'PğŠhWbbñ_,ÑÉxg\"êa\r¡Òaa@.ô†WÖû_{ñ~oÕû¿”ˆßàrĞ\0002‡…ö“´L|×+‚G)¾gL¸4¤Ãqôc!”†D\$OÜzKe\$0“.S\nùGd^’ Ã‰rkí‰ H,A ‰¦à€(€ I\náÀ„¨\\=!vê ¡½!Eæ%'KIS«yGh‰™’ºöĞ«%\"fıÛ4ôæİ©ş’mHÊ—sÓQ\$j@(b‹µ˜†Ë„§iÍA™èú™#ä„¹¨¬æÜKKŠ%‰™b¥ƒÔZ” €ğRã‘I9ÇHLBš1D	ôGÓ†š€ƒ¢˜BrXì/\0Ôè\\ÙLšDlĞ2Şœ›9ì!†f2†È›É–Œ¹´N¶Èi\"\rJı’¨@Ú\\	pjrÑ¢b¸@Âi \rs„Y–2G…á\r\"¨^r#ã€}	!í³Ğ˜Ïr1	âÃŠ €!…0¤¡St§\n..“+\r„õ<Rô˜‚\$\rh=<2IÉI+%±i• ÅŒ‘|j3	’P[Ú¸JD´dˆM(Èò…}§T¨âŠño{ïêˆŸÚÈY©'­Š¸ôÓ×Z\"¡Ñºò3(aZ\r¥,İGE&Iê¿Bó-ª—\n«UËrŠ1dBÑ'Í™Å!ªÊ4Üj¹\r!äDÓ0¢(¹Oå¼;€Â…ãˆsmHàIbÜ0T—ÙEŸ˜œ­	a ()äËod3HLï´øI%ÅPåÂä‘wWDÃ©,\r2İİ‰qŒƒ±’ëòkl‘¨ÊAC\\w)z`*ì½—€¿Şòz¯’‹½¦ALH¨Xk'UÄ˜SË°#	Châ“Ó²MÉ K0×Ñ¢&Æ“±BÄà´£²bâˆlq\n¡P#ĞpI/Ó¼q®åÛàÚâgè]¦ãÖ›ª «JæÅ÷İ¯iÔ¼„aÕÛücwOí!(Îe7·<€HM‹sNØ·²€ÊD\r½’<(ÔM¤áqiÙ¤-x4Á&t*j[1;8¦4àšÓ|»’˜ÇgØ¡Ğhò}&\rÄ1š‰ôŞˆ6y;hµ…:ÎK€UÉ)Keo† L\rÒß¬íãğÈ¥eô:bı™&r}©(\"Œ,`Â)(Æ\nÔœw83*êTê¤˜P\"Rt£¶ÊÙ„4%rõ•Ó\n·GÊ[L¨u0°‘¾Aôï!bÂ^ZC­Î±4";break;case"pt":$f="%ÌÂ˜(œÃQ›Ä5H€ào9œØjÓ±”Ø 2›Æ“	ÈA\n3Lfƒ)¤äoŠ†i„Üh…XjÁ¤Û\n2H\$RI4* œÈR’4îK'¡£,Ôæt2ÊD\0¡€Äd3\rFÃqÀæTe6ˆ\"”åP=Gà£±„ôi7‚ç#IœÒn0› Ô¸Å:¡a:LQc	ÎRM7™\r2tI7ìÒkÜ&úi§Ø#-ÚŸ”–MçQ Ã¤ÂHÙ³:e9ˆ£©ÀÈa¨l–])#c»s+ƒÃÆ,†óqÒïÂXÌ¸¦—Æèq9W|•Ò=£:IÁE==ÜÎ\n\"›&×|q'o–‚Š§<qTÜk7ÎæèÁÊN9%\"#pÁ0£(@œ¶\rHè‚6¨zÎ‡0£˜î¹Œ‰H ¹„3O¬@:¥°;\n¾ª‰†ZÁ*\nˆ£'¡\0Ô™²ìÊRƒ—CjÌˆPå&ÂcÈ’Çâî™®‹ˆ¤éŒ®0Êø¯\n8•\r({c!¤#pÒœ¶#‚,Ú9ÏRÒœ¸¢+Ù¸¢t¡ÀÃ¬Â4Ìk›ÆŒ´ÏC›8¢jÀ¹ÎJÆÉ%ñüÔ;!R[<ÙA(ÈCÊ ÑTeØCÍ(üA j„8B‚N1³À8¸CeP³`ŞÆ¯Bxå!¯(˜õª\0P‚êºâš,2Œk…jô©hÒ½’h‚ˆ®jâ Êlp\"£Hã‹H¬\rŒZ²QHQvÍØ£(İ¼ÃCÎ¹Çâ@	¢ht)Š`PÈ2ãhÚ‹c\rü0‹³›]`¹Ko.Q-ˆÛÁaàÂ ‡ÌàéR¿‰rÄÿ#ÈxŒ!òS‡b˜Œõ(Ëãªb»åP0ß@Ê\n>#9†U™æêlJ9ØWEn§° PØğMHÀÃxÌ3=VŠS_HÜÈ¯CkØ2H‹®*\réŠ\\<Ãìˆê1¬¨ˆÌ:¢õrìÈ…å°]VÓù–R:°İ7¡@æéí‚\$Ë*«ØÛ¹kç±ïÉBTÓ>íˆÍgƒpÎ#&ì³m£™HhöÒ³ƒ0z\r è8aĞ^ıh]!rğæ3…èÈ^œ¯s˜„A÷pÜ<ÙF=9ëL²š8\$ÒÃ¶ÁĞÌ7šNğ4†ÔĞŒ;ÀÂŒ'Y¯¾C9\n„øÑĞô}/OÔõ}hï×òËºÌv}¨İÚİ…ŞbHÚ85Ñ³šğ™º6„ÁE›0@KCZ\r(-/5R\\FC¡)Yd¿\"tÈ©a6èœâÚº¡\$,AİÀî±È¹ƒ!Å™ÇµS¦Xƒ3Øpí‘¿6vÒÛX „ğİ cè‹#ß‚p6.‚eƒB0gDe¿—œc6ë‘úÄÈ,lB€H\n1¦AA\$`§£ÈzZ\"¡°”² Ü´a!æ6F¨Ö,s^¢âë+6'å—•\\Î™)=ÑÆxe‹¸v&g¨Û’˜BY Q±OáÀ0–P@Ë \n\rÁÁ7=”\$…!Ñ»\$pººU¤Éd(t¨’ ßOàC\naH#Ir5\"ÒÙ(Qsô2\\ØXl#¥ÁêÈ!+B‰Â9©m! bdM	´R@Æ5ı‘Vàr\\/¥”Å%À\\¹CJè¢	ËLy&¥´t7fÄÎ*²†I9ar®ÆŸÀÆ«ô7’P3ÊĞ Â˜TDHí!’Öx·\0gGÓÄ¨‚–©i#æô–’ò;%[ş71H“%Ò[SaË\rÌ‘RÈc¬e‘SE†4şU\\‹Œ. €)…˜†c° \\À€#H¶K”Y6‹²]†ió‹ïJÌ@b,zËÁ9%5PÏÀsbÉŞ«fvª†ödwZQ5\$¿Ã£X—L‰•º/€xC`+Ÿá¥UÔ ÊHs\ráˆÎQ²Ú«ˆô”GÄa3†Z«‘Y®€ì2SË`@B F án9£ä‰J‘3Š…T¢ç]Auq´u••ÍRÎ¹Ñ™|'éYF¸(ÀÖ~¬ÁÌ bPf+Ù`ÀæYNjMIs	^\"‚\nMî\ra8¡U7Ø\n6ÓC]^º&6Ä‘ÒÆ^\\	%!07Ó‚oaM¹W‘!eBLÛZ?bé¡“d”lEup¯ñ(—EYıªÀÌ‚«æT\"@UË\"‡ˆº{mtT&ÁT2ò<Áæ±x66ğÂ\\9oªæ=ÍU¢.*Ğ";break;case"pt-br":$f="%ÌÂ˜(œÃQ›Ä5H€ào9œØjÓ±”Ø 2›Æ“	ÈA\nœN¦“±¼\\\n*M¦q¢ma¨O“l(É 9H¤£”äm4\r3x\\4Js!IÈ3™”@n„BŒ³3™ĞË'†Ìh5\rÇQXŞcaª„ch€Ç>«Œ#ğQØÂz4›ÁFó‘¤Îi7MjŒb©lµ˜LQc	ÎNE2Pc ¢I¸ç>4œ°œ1¦ªe¶œŒ·ú©Ê!',›Î¢A†+O_cfÍ”çk…NC\rZÖhÏbL[I9OvÍqœˆÅ¸Şn¡±ØÆDé,›‚¹\\Ã(ƒ—¾ÇµGM7k]€3‚ˆ‘c/_4IÈ›å`¢©Ï&U7ÍÆó¹º094Ã’N\"7¬Sî¦í³`: Ò9Aƒƒ9ëàÈ“Šà@35ĞĞêË„ªV7º¦«2Æk(êR˜„RbÎ³é:]\r©ò õ@®j\\9.ÓÈô ¢\0˜¯«Ğ¤2Œƒ(#Œ¯“Ú¾È\" Ò‡¶òhÌÀ(h‚‹7#˜ë\$/ S  ¯¤Å2/Bš2ÖÌÎ„€Í	ƒzşÿ'©úXŒªÈ0Ş§Im#È½£ @1*°BĞôKl4{ö¨^t¸b\n\r0Æ:Î`RDÁ\$Iğ@6,ì'Rk:&Šœ ˜e:¢í=ƒóWÌÁjV4°oX ¢#« ½#r§ˆ¨Ò8ÍQ\0Ã`CcxÒŒYÃ\nnQt5¥`6ã2ø•[İ´ÓCÏqB@	¢ht)Š`PÈ2ãhÚ‹c\rü0‹µÃi]9î£x› ª8@6Ãğ`x0¨áóD:TòX#²\0òã|“áøˆ†çËc=@2ã˜ğA…0[õ3ÌSi—#èò3™;¸T5…DèÈç]åâc<ë £cÈ5-Z:îã0Ì60\n½p9#i»“i³B Ş—¥ƒÌBË£ŞˆŒÃª/TNã˜XµZõÕi¿Ùm :J°P9….(Â‰·”;A­ì‹x“ŠkópÃÙøÜ3„Éº'ÛXÆççòj=‡µÌ„C@è:˜t…ã¿L[\\„¾áz2¦ì\n„ç…á}Ø·¯FS×‹\n©Í´0íp|7£Û@ê2…±ö»G.†¤&±ª²=	\"0­ZÃx-.sG5ÎsİEÒtÃ¿QÇê=XåÖõùë-]ö¸ˆ’6\r§¢:wy¤r	r†p5Ò‚—ÓÒÊ:İÃ|H!¶\"H­,†S^mq¬1K\0É-²PèanÌÿu€EÌ\\\\Dı&1€Ìõœcm•³§f[	 ¿;§Ù–ç¼ŸàleäÎ„fü™ùÏ É½AJa‘DAA@\$ƒÎ¼O‘‚ªŒÌˆs!å@ŠbNÈÃrÊ„g Üãd°\rª†‹ÜàŸ´`•@wI„œøD¶ÛÚ¶3†\0; ààù>€ÆŞF(Eô\0’À:¡&ö”0w8Œ40²üç›ô:-Á…µ&µOğC\naH#â5!’è.5s%ªOÛ2l6A>5 ¢tÎC[Gt˜\"iì€	y<”„Â3K¦8!’<‡	)”íœ²ğ’@ÃÉªD…\rÁİ\0·4J”ª¡³L[\\sª‡Gø1ª„A\0\níH(ğ¦\"=I¤­Ÿ®p@Òç*à%†@ê\\ˆù‰%d´…N)·/XÄãbd’dàÜÉU0¨µ¤N)\0Ò¨[Td1à@ÂˆLCqÀ.`@‚¤V;ze¡¼ƒ4ï‚-PŸpŸC\rC4ËUk¤ÓiI2«©\n\n¥®%®oN›P.Pz£¨”ØUV•Ç‚X€¥¬‹mb!˜ö®u¹YâŒ·\\•®¶°ˆÎy`+¡¥R@Ş.Ê¡ë‘Ø “-Uœ#SF;aK-\n¡P#Ğp¶™‘qdF*¨B«4‹¹n‚=WÜB@-¶Š.x†aHa\"J2‘s.ÀÕÙÔ‚¤Å†Ä‚Cy‘Áå{PÆhƒ™oz@)%ÛåjŠ”}ˆ=ÇĞ¡U¦˜©Ì\0k:¦JÂ¤pCL:`îØ2øIÓ­+&¶ŞpzlÑé\nÅ;¤†.š14IFÙ³Uœş*z„PÖœÒ†ûKMÌ«@ÕB¼¡âÑú{tÂyƒ¥ãmíáŒ ¸†ß\\Ê“H(Ej•ÈI`¶À";break;case"ro":$f="%ÌÂ˜(œuM¢Ôé0ÕÆãr1˜DcK!2i2œ¦Èa–	!;HEÀ¢4v?!‘ˆ\r¦Á¦a2M'1\0´@%9“åd”ætË¤!ºešÑâÒ±`(`1ÆƒQ°Üp9Î¦ã¡•›4Á\r&s©ÈQÁFsy°o9ZÍ&ã\rÙ†7FÔhÉ&2l´ØAÎÇH:LFSa–VE2l¸H°(’n9ÈL¹ÄˆÄÎf;Ì„Ó+,›áƒ¦šo†^NÆœ©Œ :n§N,èhğ2YYYNû)ÒXyú3ÔXA´˜ÍöKÙ×¬eÌäNZ>‘³¡ÕAõãó#\r¦÷¡ñôyÛ³qœÈLYN[àQ2lÁBz2B¨Ü5ÃxîÀ¤#’ğ•ˆŒS\$0´!\0È7·ğJÇ‚ğ¤ æ;¯\"V#.£xæ­ÆÃ/qpä6¢ÎÂñ²¡ ²´JÒ DêR`’*	Øèë0ãPÂ• ñ¢.B,‹Ô´‰²»?JD¼ÂÉ229#õ\nƒHàÁ/q¸),ÄÛÈ#Œ£xÚ2h2¡²ãJ£`ÒÂ¸+ÈÌ3KÃM9Ë³ãy?±T0¡®£<²Lè˜7ŒñºL8\$)˜Ü2¬ŒêşĞ5ŠZM»Í(J2|Å:5][W¬ãH<¨ÀT¨\\uøbh²M.ëÊÆÃ¬0ıÿ'C¤1Ö«)²ƒ-^èŠz=)[37\r(«J\"\$Ãe\$(T¨ê–HOÈ£ÌTÈ¼Ú0 ‚ÅL…ğäÖI›x\"\n3_®ÿ\nà/hØ­­x0£h\$	Ğš&‡B˜¦‘0Ú6…ÂØó“\"êÃp³o@ &Cªƒ\n€<hxäÀŒ9àå0!à^0‡É^k›ˆnÚ8¶<zˆŸ§‘Œ('nZM˜/Òø1G:Â™˜GuVíi[ü£Àƒdê6(E5VŒÃ4ıO¹©BBÏ,ÈûÇ;íÅ<<ÅÍ\0ê1¨£˜æ3&#e0÷…˜W\0000Ó1¥V'JrÊaJ‡Z„	°¤m?£%b£i§˜B™™/c8@ §+ÚCÆ»Që¦f¡\0ĞñŒÁèD4ƒ à9‡Ax^;ùrqÊ¥KÀÎÔ|.¾J®Ø^Ş›ÖéÚ,ï+&-V±ÇÈLt<ÓÆÁİpæëÎ·km^‘k2ÀÕ	X›\n?HdD‰’¬*¤ñ¢fhFØew®ıà¼7ŠñŞKËvAÈ<ç €xG&nChp2©Ì²=Ö L“ h\rê°àÀÖIŒÑ%Flõv·WÆ¹Êu¡ˆ:’uˆâ›/²ºPĞI“Õ0!ÜŞC'RsU„3?ÓèÜ3ˆ\$(3£˜qÎG „)/@UÚKëe4Èé´>x6H#YF1fÖ4#xu— c-&á°£ÒL‡rG=   9¥ˆvÔúbu§\0Üto)¾Uˆx9F¢OÑ	\r(;˜ÅVÊ‰!Ê-@5æHB!AËª6°ÎxÜùSNñy’4Ñ	Es¦ãÃ\0ÜCQÿD €;œ€Æ	‘kx“KĞ@FY‘–XL)iÌ\nVEA¦;À\\bu&Æh“E–¡È±\"\$„Ìš´öD•!­ODí.I»ã3{f‚o¿°Ô^œja\$‡“d…ƒJ¬“&„7BÃOq±È âìaL—¦1¸¤*qÎJ!7Ïè£ÔLB€O\naRV©³â{ß\n‹ü²¹ÆCªµSèY{F2“‹Ëœ•Q‘wGjÒËm-”´™“Ç\"‰J?M¶g³Ô]ƒy8|ÑÙ×0¢\nJ97dh#@ Bhk„(}Î”€ÍE‰8r%0P*3ÇJ:`^Di„35¾hÃ“ïd®»I^§Å})Á™©eakÂuSLØWÆ{É	Š–KîÅ(VHáDıVOW<Œ³`ì\$6ÙûCOU•¦T¦¸•„4ê]\\¡¬’ªĞ@‹íY^JqJ6ë}kLÍ¯H(ä6³\"‘ÑˆU\nƒ†´vŸ¸g%jÈ9OY6¤©Š`—rï1Õ%ŒEd*œô6Ë5=~ç(É—`›kƒË (Æ²ı£U›RµVÇ€Í,€­p[z§¤rÏ\\•ËfK¡!4@“xpJpl‡ €a\n»‘h)Bí³U—(^B?¸™Ö€¥Kà\n\$iT™·ÂxÃÖ31D—ÚSUlÏ±ÇÓÄ¥«e°eUxdX)OŠúù­rTÎ„9Qhç…ô[)ÜÉJê`->EPg„êc‚\0";break;case"ru":$f="%ÌÂ˜) h-D\rAhĞX4móEÑFxƒAfÑ@C#mÃE…¡#«˜”i{… a2‚Êf€A“‘ÕÔZHĞ^GWq†‚õ¢‹h.ahêŞhµh¢)-I¥ÓhyL®%0q ‚)Ì…9h(§‘HôR»–DÖèLÆÑDÌâè)¬Š ‚œˆCˆÈf4†ãÌ%G…ÃfÕ\nbÖ¬‹Á—÷{ÜR\r%‹¡mú5!s,kP¨tv_¥h¡n—ø]ò#ª‰ÉPÖ…'[ß\$´ÅôÖ!&Œc¢ÒhìÚK'FA¡IE\$Ÿe—6…jl°‹läÑ¬İ2\"²º\\íš©mËK×VŠ7™Å¥s6õıÕĞP¢Šhˆ¾NC¢h@©ª®zP’<‰£Š‡¸¨™lì:\nË,‡¸c†¶;ğjƒA0ÍÀÈÑpï9m³#)™©Ä¥ïŠ~ZÄc(™º1^ªåÓ”¤0é7Ïš8ÉÅª«ÀG£H©ŸµEÒ ´*ˆŠ8õCŠ«`Ù*­c¯	µ±ü.ùÄ.£®ğ8ˆ’0´	ôÏ9’\"\\ÇÒ«ZöÅHÚû8MŠ²ğ\"ò¼?>jRÊ´ŠñvÈšºåkÂôæKòL´îÂd¹ Ä£ÛEQc* \$|z“Î2ÑqR¸Î*JC²êÄ<hñªşäš›|â¨5ú˜’ÕËJ~Í‘o\"Ø¡Ï(ãİS·Ï‚’ƒ7°Úxû¤11VJ•å¢ZN3À¾2Ê’O¸ó Ç-“ã„ƒÒ‹ÏS£]Âô'Í|­Çˆ<@ãÜ2ıÅ:!(ÈÔ¥i0…a‹ƒõ‡áfƒU‰/uhXI‹ø¡pHäAŠ\rvVÉôŒš£J‹-…â5bÊ8JĞ³‹¿%šÚ~ ¹õ£µ(¹Ñ ÇÉT‚h¨]g\"¤;õz\$È2ÔË(8á O¦š{Uºê¨×ªôºT¸ND^O\0ÔwÄHªè™}*¹+š¯Ç[!ƒ¹sÊ‚_ÀI¡¸)–è¾n×½­@on¾­–¸­Ğ=í÷ŠñÎÊ€œóÓåqD Õ	N	Ù9Ô@\n‡–r¶^ÂÚÚYöâì‹iNJÊBŠü.—®aàÂ²‡Î4~£S0Ï å¦S`xŒ!òsãyäN1‡§ê¬ƒ›½ğ­ªù-eÆpç®½ú~Ü»Æ‡Ğh‘ßT0ú<Î]§Å§Ü|ß‚F®t™+  rHæÍ„îDÏ‘üE†‰	Ÿònò–ëG*ëÈ’#SrT_“1feTâ»†æ™I~É¨+Â}ß”4il2ˆ\\œRJ{O¤øö®b®ù–å‘Š´¬óHc’@}+¥¥‰áì&<D6+ˆX¸*Ì†ê&‡#\rKcv8°ä¤Ã²eNü?‚ñ\n\"B3æó@‹‰GòDâdR…PãÅh^™¼Zc0Ä¾ÁC~ÓÚÜaBNò.‚c	!óöˆ*	½Ähà` Yœ\\EA+¨±cy\"~õšªÁ“zıf/¢¤ì¸Ö‹@ˆìÈCHn¡È(w VÈª°~æ°›R8ßÔ¬\$E¤¡ã\0Ğƒ(f ˆ4@è˜:à¼;ÍĞ\\e¼¹—`¸7‡ ÎÃ(ná7†àÂLíà‰ä§u,Hä²¯}ë#Õbğ\rò|3§9VÈò EŞŠTG ª©{æJ€‡’ÉøŸ„<øå!k\$z4HjâNÂW²¦üš|Í™óFiÍY¯6fÜİó~pË å9'4èA”<IÒçŒêOel”\"~S¤i	ŸŒ¿š7Ã/_T0I+4ŸõÒÛˆÑ–I(‘Q˜Š»´WÒüù¢³Z…h‰w‚-œgæıb—-\n™¡Ğ9i#Iã/°9g¦XHÔ	ñğ22¾NIô§d2£FR‹ÂLM©¾hiKX8€s\r)[¬É…²†€Z™ãIJ\$ì*¸\"iØÚ\"´˜†y<|“ñ¤%ºÑÂÿTC“îÂ¦µÍd£ø ”–ˆlCë|’DF².Cr~ÑV³¸CëNYÙ–e'Â.ºèæ€E™4–ˆŠ¿\"â>Ğç‹ÓÄ5‡ÎÇ.¹%’ÿ]JøR)´@’~&M4É¯*WquSo:13ÓT#•™ÜA˜_ëöèG^Uµ]gËì]%Ì” †ÂF±mÍH‡Ís—¾+¤T¦XáVKÁSPän¹¶Åvî\$¾\n[t%¬Ş˜zkãÄ¹PFæWÕo€áõg™v´Ë¨i>µÙo*:5!Ÿ`Ğ¶…)Õš™lpµŸU¹ƒN­ÎµvæZÓYwCØ3_^0íBXù–À†£ˆ\":DØE*ÓÄ ?	ù\$ˆ«\$€O\naRÙÌš!dC(„~G0­•ÔQX=cDER{¯£¢¼\0BŠşAü¬Ÿo²'fŠÀGbŒJ™S/äCóŠk×\0¶çç™²Ò!ÅÁ˜8ÇÚ± †‚+L(„ÌFÙÊI-‹\0€#@ ªNªÿº÷²ì3‹K|^uZ¶‚ƒD y‹@—#°”BšŒœ‰İGZ…£Ç\$Îğİ;¯z¾ê¦WÏR3®)Í%²á8¹ÒÈå)FÜÓ»c’áÕ'p·5¯˜«€„“‰9HOÅV-~sdk**~J¼E8!ÀØ\nÆ€©Z¯ØâÜÛ[\n–WÍC’%,†vuPjR©Õ’ÛÇÉ!@§AH)+ºğœÖ­8ôBÑtëqu\n¡S„èVêæŞë…âFÜî[/’[å°¡éÙsìü×8.×·{s:5İÅ…÷:PÇT¢anMö”52úën l¹°ı3?›PĞ[ó‚£5mnÿî”G5Bø{aŒU )ş&yØÛrŞé>Uæf3ÏrqÈ›ˆî8Zßñ:.Ùˆ¯« @0…]GâÈÀa½öDHù!!¤qcf\$hÕl»Èü’DG/¯AˆZµª¸ÛVÑFş£©²2ÿ*F6ÍW¹RebD¡v˜]Ğ\\üÊÚC¼Ïe€‰¢¾Öí¾º†xi¢z&NÚOTí„gÖe(\n£\\7ò8á\njÂ;Ct\"´V/¨ù	ğ!¥,¬LÎ\0-©B`";break;case"sk":$f="%ÌÂ˜(¦Ã]ç(!„@n2œ\ræC	ÈÒl7ÃÌ&ƒ‘…Š¥‰¦Á¤ÚÃP›\rĞè‘ØŞl2›¥±•ˆ¾5›Îqø\$\"r:ˆ\rFQ\0”æBÁá0¸y”Ë%9´9€0Œ†cA¨Øn8‚‰ÆyèÂj‚)AèÉBÍ&sLÊR\nb¯M&}èa1fæ³Ì„«k01ğQZ0Å_bÔ·‹Õò  ‹_0’q–N¡:Q\rö¹AÚ n4Ñ%b	®¤a6ORƒ¦ƒ¡5#7ü\n\n*ãò8Î	¿!’Ö\"F¸ëo;G”³A#vÚ8.D8íÜ1û*…†­àÍ—É™ÌÂ\n-L6la+æy5ãO&(î3:=.Ï@1ØÂˆƒx¶¡È‚\$2\"J†\r(æŒ\$\"€ä<ãjhıŒ£“B¡«z‚=	ÈÜ1º\rHÖ¢jJ|¦)ãJ¢©Œ©	ˆF<ğ»Ş\"%\n”<‡9Ã\n\n)¨ûæ1Œ P„º¥’à)µ,`2ãhÊ:3. óº-\nn9fRƒÈà<B(È4·C(\rã¬¾VÌ)±|	²19¢Ã@Ø”nCÜ\nƒ“£AÌëXÓAP‰‹R±:	š\$á\roxJ2Î:4İ;O5\r9O7.€”\rÃxÔI¡ l¥h¿CBn¾:@PÖ2©Ênš¿\"Ğß.53{&\$Ó€ m«Ş+MQíz\"…¯’.	ã\"tÔ½s÷\rD²Ğé@<èÄn[Ñó!%á&=i‘z¢Óƒ-²0¢ápx67•ÛzÌ×ÀA}[Cc¥èÍç^Ğ&\r„_ˆÀì´(èõ>	Ğš&‡B˜¦pÚc–T9¯Ğák'ƒ\$ƒMa\0Ú:ª!\0x0¨Áğå-²“X75™PÂ<‡xÂ\$9Şz!ãpÌ¹è#.“¥Æë\$\"ÓZ”2ŒÖ&S”è\ré¼G\rO+ÏŸÖË`2ìÊ6º²¥clØ6Kˆ4F7ŒÃ3bˆ)1\nk9[´CB±ÕÒÅ”)¤ô–\rã^pè^NUAñtÊ “)t¨¯ÈÌ\0è!Ë66®£ª¥qÅkbòòUŞÏË|Â3GqCŸ=ĞLˆGI4tÕk¢uUX7uØ_cÙò)¯låòã·3Şsõaàt^uäxİJåJĞèñ>Ï=Ínƒ-ŒúĞŠö2rÉ¬ñ5¿Ï;Ó\0ÂÜBdyh„:ºv…øf ˆ4@è˜:à¼;ÁP\\_ rÄ,3‚ôÈÖñ+¥¨‚ğD”ps”Üµf”ˆÑ4bô—§\nÔ+QCå¬ò›\0ÂèÂ„Dg¹Í!ÁZ‡9ÑC+…V“³¦ ŒI2! Œ¡T}Ã”==`¹â8`TĞB	AH-ª!ƒaÊ†0æÊy¡\rĞä7BfzChp&	h7(ZÕá‚æ\"e£:\0NRá\"äf(£`á¼t}‘ò)3fp^Ôèy'„´—“ÌHV‚Ò!¨})b2ğ¡YåU¨z ¹Òd+H!˜:­2‹×Xæ”yëw'D1¡ĞÒuEÑ\rN°——æeÛcn­ÁI„ãR‰í*AÂJœs,QBB.¡ˆ†‰dÛO4Ë“ÒÀ`R†H±(mÅ¨ãL<Ü†r°…›¤<ÜPœœ&HÎ˜Á^ÂFuÔ¢‰„LkÈW’­\n'âˆ„ÒĞdH†¢”âLÉ8´21I£¦iiÎ.©Ö~Ç¤½ k& €!…0¤¢âİ8Ä¥8@ÌBÙ»œ!‘%¤åâZÖ\n9Òy{Ÿ\"JgÉTˆ\"U:6r]>á›Rç.£°/O*#-q7dæåKÙ7 ˆ9=ò%5ˆ¡.EäA‡¶Š ¢¥˜:äD_ˆCß*%°P†çêº“v¤á‚…\0Â¤ÑfuV>Zkbnm˜=Uz²Q\"¡oXå50ÎĞC\rC\rSD4³ó\\˜\$E^\nÉêZ‚\0¦BaN¤ı›:4/’Ùª#gö¥Ş‹\nF\n@ä’d\"n‰<Š Œ»åEË\r2\neN’ó¼O‘f.×ELâzÍa®¦ÀÙO!Cw18gŒÖïã…'¯8\nTJ^ô¢ëªFvAäÓTDHB\\\r€¬õÖj«ªt„F“—@kˆ[@‰1‡¨ød‘‘K!ŒÜ9y2O²ekxèÊğ@B F à°µg¬ò^êˆÙŠ\0Y;`7âVkyal\0ŒãÄEŒ˜–@ÆÍäè¨`8(12+\"áÛ02gÅIÀôN¦™p\nÍ´R‘´ØN¹’Pb>xX÷ìÊ­M/ìã·÷è|Áh#¦(™ËB#O9<'Œ6XâˆÌ¬‰bÏúÄåÒâ¬S%©z\"Uì‚ePkŞ«¡tJåo’œ3+x5ªc0üÌ&¦Ôdä;-ÌoPâ\n	dağ˜ÀŠ.8\nåj+¡|¯‹3:†ó(¦QBFP0g¼)j„ØÚŠ\\º×Ü‡:ö«/€.";break;case"sl":$f="%ÌÂ˜(œeMç#)´@n0›\rìUñ¤èi'CyĞÊk2‹ ÆQØÊÄFšŒ\"	1°Òk7œÎ‘˜Üv?5B§2ˆ‰5åfèA¼Å2’dB\0PÀb2£a¸àr\n)Ç„epÓ(0›#ğUpÂz7ÁP³IœÓ6A£C	ˆÊl‘a†CH(­H;_IÑƒ±Êdi1È‹&ó¨€Ğa“CÍõ³‘§l2™Ì§1p@u8F«GCA§9t1f\$E3AÊÃ}Ök¬B|<Ã6¦¡ë?•§&ÚÆ·_´7K08üÊ±·™ÁD“Ñ‹*ÅPßIFSÔ¼U8Bî·Ò©¸×i;òL§#”.}º˜Npƒ!¿7’™œô”Ìàùcº2\$BƒÚ9#hXÏ¿´2¨ƒ:V7ŒˆÌ(¦°@½èâƒ	¨ë¢T‘¥<ËŒ R~:¨sj° ¬ºKxÂ9,@Pš†\"‘È2ãhÊ:IDrğ<CÄì\rk˜Ò8<\0Ê;\"+ÖïÁ²PÓ&2pHÊGãš\$@ÃJTÀ ’ø¨×\rHƒ)32Hœ7ÃJàÊ2HC Â£H:3àA?\rK¥>ÏãMAÏó <³`RÒ°\\”¸bé»	Bú5§#’`—+Z/6Bd‹E\" Êà§.›ªõ¯¢(Z6Œ#Jâ'Œ€P´ÛÊqLÊğ¼Òø ‰”-ÊûcÌK@œÃp¨Ë[×+Àf\r‹\nV¤Z!§\\WJU®˜Û-˜æÉĞVıª4…×š±\rzuiZ•Ôè‘HĞÔ	@t&‰¡Ğ¦)P ÚocØ.ÖK³*­Âã¢A=³ƒhê™àÂ‡ÈdYtn×!à^0‡É5cxÜ3-£ª“eÛ8ÚÃ‘SLº³°@…ÛÈƒR3šwoğİeÃ›Vî\"jú6H€SÆÆê(Ì3%Ê#W\"±ë½^LèÃæ\nƒ{'\\\rÃË?¥£ÆÍc0ê6’İ¥Ár&Ü0ÂM®q\nêCpê˜S²³:W‹	Bˆ\$B£ó3ƒ6‹º!\0ƒ<-ï\\1é£HÈõã)[Z2ŒÁèD4ƒ à9‡Ax^;÷soÂ½ar3…ğ€^ú¢¾\\„A÷ˆº9¦R¬Ué] ğ¨6È\\@ÉŒ7Áv\$è´Í3~Ê\$BkäJÜVñ(/~¾4Ç!o_Øö}¯oÜ÷}äïƒ“ÀxA•¤¡˜C	!´8„„ƒ£ÎgÉä4!C:ÚÃ	 6‡øõ¶Ä *A¦õmªòBrƒ\"Äa †ğÎÉB)M 4€ÂŞ1Éêé¼b¶zÜĞrHHT0†gĞA‹smÕ»·˜\\maÙ¤3°Ô‚„{ƒá¤ˆ´ähC\rñõ4Hdƒd ÏĞ©á…p‹¯Ä†¤\${ (\0PNÁI#	¸;órÉ-\rÅ9Ó<WŒ¹™Nì@ş³s8ZI™\"Aİ;’\"KS9D2‡A¹¹XjC\r¡œ[gı¹œˆ¦Bxppïª%¾Ä*Í(c^-H3»B\r!a…‹’”ËºgŒäp†ÂFzëì,¢µX²Ù}'`„!\0Ök¡#\$¤œ”ƒ°‰×²¦å•âxg\"ò2†m°‹ä! Â{ou:MÄşÑ	I aäÆ—L~HnB¦ÓC©›&a˜öç>ïL¹9!Œ‰8§AOùšq“\0—!ãˆz%a@'…0¨õÂÓl\rGb{‚	¾”çjhˆ‘ƒÂI‹…!@å¢xäÎZ¼XYÆ€‰vC\nƒ8 \naD&`ÏL	+ÁR:–*‚Oá3\"Õ:†¦äIŸúd/iæu“ªeC™a£iá!Î£Â¹Ï©©'!ºµ§–´±€œ•Ğ¬'h\\çR‚NÕ²\0§_…s[eÑnØ4ò¸¬9¯ó”‚.ˆÓXÒì°Ö áNUâ´,˜#Ú@¤@Ø\nÃ]6Ä°½––1HûÑ³¤ˆ#+¨NÅÉœ>6¡T*`Z¤/¸3—˜úE!•B¦ÃËµÚn<î\\Ö1A\\Â.ìÕĞ\"wH„.u»uŒA!7jä/•k.l–„ä,†›JÎóéu.é|&¡@ÒƒÉe6ä’Ô¾‹¼7LÁÍ&€¦dÏ\"Y\"Ä#«MÎá!À9×âßƒŒé0©Ş×rD}F…Ğø*œCpÎ‘Y6JøÛœ\$RË½,íÜº'«ªa®¸aQw‚ìc¼qxqõÍzb'pÈ‘bUR>£;´ŒÂJ¿Ô}`ó&j0hmÉl—ì~ëí’²„\\8\0";break;case"sr":$f="%ÌÂ˜) ¡h.ÚŠi µ4¶Š	 ¾ŠÃÚ¨|EzĞ\\4SÖŠ\r¢h/ãP¥ğºŠHÖPöŠn‰¯šv„Î0™GÖšÖ h¡ä\r\nâ)ŒE¨ÑÈ„Š:%9¥Í¥>/©Íé‘ÙM}ŒH×á`(`1ÆƒQ°Üp9ƒWhtuÀ‚O`¿J\rœ•¢€±®ğeş;±¯ ÑŒF\rgK¡B`ÉÒŞıX42¸]nG<^PdeCRµŒÇ×¼íûFœÏt ¢É¼ê 4NÆQ¸Ş 8'cI°Êg2œÄN9Ôàd08‡CA§¤t0˜¹Õ¸D1%İCo-'Ñ3õDo¶8eŸAº¾á¶í”ÒZ½ˆ£ÎA½)ä¿@{b0*;pš&Ğ\0¦á\r#pÎƒ4í‘\rY¡¨Éã] Ès(¤>ÍXª7\rn0î7(ä9\rã’\\\";/Â9¸ƒ Şè¸£xè‚:Ã„k!Øæ;Æ£\"¶N\"ëã\\ˆ£‘:C¤*’ü‘Áí	zˆ§E¢<ŠE-à¦êÂ¶½-Ğ½¨©ª\"•#JÒ+d‹´¯*{Ğ^@éë£5è1DKùÚ0j²F9Aš²ƒhÒuPÚ¬XDªû*“±*LĞü¢Ìèü5”ø¥¾\nMC+T•M*¾Mrƒ&ÉÔD±£• OÓÉÍKšõ>“ŠÇ¾	|¢ø0(Í`A(Èˆ´oR*ÛVâck\\ÛEqªJ‰ØHü\0¡pHŞAŠ·b?tëĞ²öFÁ¥ˆ‹.‰ÀDš?¯U1eÔ¤5H#fØĞÃ Ğ´mƒ*ƒ¨H]9«äE¬ƒÈ•¤ú¨éÑdƒ_\nZXÈ6x21¡Šgp¬¬£Ñ`¢*1wç&E-*È†‚”!Hc@\\¹u*™î=§hLşAêšB¼Zé™ÄèÃçk} kúI.k*>”‹¥Õ#BZB@	¢ht)Š`PÉ'\r£h\\-<ò.´Ø½ÏA™Ê\$¯*–Ë¤6£œ†*À|9£ ê9F;Œ#ÈxŒ!ò]ÊrÂŞ7ÃHÏÍŒ½J++Úq»¼ğ¹İÀAÆ#wxâv¾j2ĞÜ9=_s^E\06ƒ“xß1ßŒÃ0Ù\nŒ¯\"hÄN\$H‰S÷P¨7¸ão<<„¯–:Œc¢9ŒÃ¨Ø\rƒxÎ…C˜,:aÉøÎ]»·\\!µ\n‡S´\n˜)+bR£`‡JjQ¤øà¨pQaÒÏÈ¡PÎd¹@ ÆóƒHdF@Ê0è\"\rĞ:\0æx/ñTø²5à¼2†à^ty±8è va3²tÄ„´\"n©\r‚Sél²%tÜGL%+=c¥’HJ2«Rè–€ šÎĞr9	)&%¶ò€is	:laÄ:‡ú D(‰¡Z2Ñ*&Dçòc«à‰ËÚpm‰¡Ò-;éDwzÛ:€÷³ˆRB2}Ğ°7DÁÛ[FSiDÂ’bmš«ƒb/(–°ÅĞla)	rƒˆCRu`€;œ×ö pFPŒ9J%¶C4yHÕû¿—öÿ_ú0š§péÌâe rQ†ÂxĞ3ˆ„§&¼hVÀĞ&P.Â˜˜“N}!K%â!A\0P	B~¸¶×@	¸(+\0¥1ĞFŒNTQè%Ix—: İ&Œ&:gäœ³šsÃ*ÛHÁÈ:#¼R÷¡Ş˜•²`Q“:–6FŠ“Â|ƒ¦j2•çJC4’ı²0;’¼7ÃšKI³Pî†0Ñ+t;bvœ@Æ\\‹áZU\0ÇÔ\"jƒS\nA*A¦€ËSªqqº8¥æO‹ğ„`âğ’¯u(jHb  íˆØ†\"`•Ñ¡!FÉn'´âÕôt%\0£+j ĞJ\0°h	@£ z]]ç„’^Àd†4à‚DÙTwN“˜!Ôè¤0Ìl(ˆğ²=U4`ßê<´İ\$mÍÓ>)dp¾…\0Â¥\n]‹XÚ9p`(²\r±4¤%§vÏ¸ºW6š…'l·¯0²R„MH(ªêN…èÑ°FXıF'_‹!\$7ADª›¢î	q½7õgûÍcuÀ€)…˜k½9’#J(ç–Øi“éÛ[ëmC‘ÃFÇ²î6yc\nY<*x”PëE‹¾.‹í£«£`Ï¡äÅ©½Úãsz\rÚáQKA7ÆJúNŒ¹?¶tÒ´Ü–µãy%¡YEWåF¹•“)ºº™;-•ü¦di+Õ\r€­4Zb6˜Ó…ó27ÚdcÓ^S,(\nÔ¾V9‡Y¸U\nƒ‡ƒí’%Ù*è&+jJ5B)umç\"†ÕĞEÑR¦ªÑem´ñÙ\$@…MåHë@‹!©ÊjğãÖ0øÈÕ¨>ìd„’Xí*CHf&L²¶õÇ/•ØĞd·Ğ³!ãj\rS1DØĞŒŸ=H-õa</{g‰Ê‹%òÓ÷Õ,A5M–9¡µ™İ©ş›ÕiJÜ¤×c†PŒfÅ!Fâò,!L¦±=íkU³¥tn ¤/ ı°¨˜e9ÓF˜—šD_Y\"bÕ(‹sY	Û,UËê¶¸™„ã5Ÿ1úÑ¤Ù\rÈÍ\"Âƒªİ>ª\nX¿";break;case"sv":$f="%ÌÂ˜(ˆe:ì5)È@i7¢	È 6EL†Ôàp&Ã)¸\\\n\$0ÖÆs™Ò8t‘›!‡CtrZo9I\rb’%9¤äi–C7áñ,œX\nFC1 Ôl7AL4\$8Èu‚OMfSüt7›ASƒI a6‰&ã<¼Âb2›\$‡)9HÊd¶Ù7#q˜ßuÂ]D(­’ND°0è†(àr4¨¶ë\$†U0!1ã„n%Œ(Æ‰ì:]x½Idå3†O´Û\ræ3D†pt9ÏtQNÊÿÆ·Şö!†Å§²İ¾×r#†-ÿ+/5‚ˆ&ã´ôÜdÍ~hIšóĞİÌ':4¶Td5gb(Ä«è7'\"N+<Ãc7\"#Ì‹¨Ãì£¦E#Î¼¾ƒ’j(\n‹\$Cr’Å¯ã\nL	Ã¨Ú6¬ˆ3C7Mà@˜=˜è9<Ë«°!\"\rhé8C²Èğˆã*Ò„3	#cè<JüÀì#<²C&š£p&?É,-°ìR \n Û\$¨J 6L#s+( Âğ„¨¸Ä<¢@LêNè’\n50cpÊ5A b„¹ISÂ•GÌbõŠmûC(ÏBCœÜº+d(è…§ÏDR\r” ‹3¤`P²Ò¹,Œ´ÂF0ŒéÃ”5#ÖÁÏc-X6’1@ÌÒ9×•óBOPe‡b²så’4Ùvm~Õ\$ãpê”	Ğš&‡B˜¦7HòÄáj,TõKRøJ\0@6©h@*\0|ãƒ¬-¢ƒ“<‡xÂ\$÷åü!ì*Û¸N)H†0Ù‘ª)ŞËÊö°”à†cDÎŞÉ‚ôŒòŒF&\r)»°6Fh2ÀÖ·C0ÍPMšÉHÌŠ8:Çb3?{¡‹¢86æ£˜Ø<ÙÍR—6f4ül3Å°äà–ÉÜİ\r°Â/¨[Ã¥¡¥kÚebÅj¥ª[hœ×6²¬¸33ûÅ™l›5îˆivt'Á¼šÂë;#\r}®´¿Ê°š Œ›BÉ®s07\0003¼Ò9H3­\n~X®0Ì„CCD8aĞ^ıÈ\\ŠóËâp3…é(^2b-Óˆ…á}âPLf-†9C.åãÁ3ú[\réĞ@»cP:N\$£°ê2&E³ÿ\0¡¢ôû<`]}£ƒG]ØvC§iÛw×xDs¿x!¹à‡‚\$R^£É_Á\$6‡HŠ\ncÎa@ù””dPZ»|m®¨…ò8jˆJMIAfi\rû” H9½C:Ha-\"aØÜ²qJIÆ¢TÈÕ €ÖZQC•{PhÆ Ê;*A\rMªµvğ]¹NHğçÖƒ™¤-Ñ!Ã4¢BYrf&\$ ãRDÂ€H\n\0¶0³\0ËIc¢Ø2 PPKˆ5ÄÅRGDI9ãjM!­\"òb¹™3a¤Á5`àoÖ«<?dN6ŠR\$ÚIng¶*Ås+Hü[4æ=ö¡Ô>BJ(/H‰©+‚õß\\<!€‘–2¯ĞD45ˆ’F´l¤É#&œ0¦‚4l\råŒ“\0¦¶ˆá†„aÕ°ÌŸ*%„¹Å\"hƒ!™|–BíñT–xêøk3ùªx¬ØÍ`¶\rLlô¶W/\$È\$ĞjÅ\"e`]Pâ°AqŞ–J%Á©,Ù	¨z±Yä-#hŒ(ğ¦qñAò\"G\"püÂiY}ö²²<g™@]Á¤ã²`¤Á¡ˆŒ¦GâU!ÁL(„ÀZH–!š#*Zs j–5€Ğ(V”Š#¨ 9§7Ü‹ÕÂØ)Gq%z¦œ‰ÛÖAf0à4æ½µ#6µ•z‘z«XVªÈ‘G´ÏÖ2*´İo3¯Z¹,§)]–à\nhÌ6°Ö–tˆe %Ye\n åvŒò`¢28`)a•7!¤P©2AÅ?'	L'³EŞ°i©)(ÁVU¢bÌm'Z¶ªGÚÊÈÉ8Kt­Z|%UR]\$VBóœŒ\\ÊEøŒ“\"ŠN2PRçÌ‘{¢r\$ú\rÓ2È;%c§b[¦ÑD¯/@™MÀS\r\$lBÒZJÉ8Ñeœ[m€dµö…bàzZl& (\"‡‹jiÌÀê\\)¨åç7,á¯¤ÎFàÜ»bVî d5	,8\0";break;case"ta":$f="%ÌÂ˜)À®J¸è¸:ª†Â‘:º‡ƒ¬¢ğuŒ>8â@#\"°ñ\0 êp6Ì&ALQ\\š…! êøò¹_ FK£hÌâµƒ¯ã3XÒ½.ƒB!PÅt9_¦Ğ`ê™\$RT¡êmq?5MN%ÕurÎ¹@W DS™\n‘„Ââ4ûª;¢Ô(´pP°0Œ†cA¨Øn8ÒU©…Ò_\\›ÈdjåõÂÄ?¤Ú&Jèí¦GF’™M§¡äSI²XrJëÎ¢_Ç'ìõÅJuCÇ^íêêÊ½p… i4ä=¼šïxSúâÃ¶»î/Q*AdŞu'c(€ÜoF“±¤Øe3™Nb§‚Nd0;§CA§Öt0˜¼û¼lî,WêKúÉ¨NCR,HŒ\0µkŠí7êS§*R¸Ş¢jÂ¶MY`³¸,ù#esÿ·ª„ÕÂ‰r•Ê¢±µñ\rBî‚¢ãÁĞÔàB›¶4Ã;…2¡)(³|ƒ–Š\n’D¡¬‚–à@\0Pª7\rnøî7(ä9\rã’\">/ÈÂ9»£ Şõ;Ãxè‚\$ã„Ë9Xæ;Ì£#w¤I´@´¥Ìk6šGô\"I îuW(ƒR0,d‰­ğù\rÃ˜Ò7Éj*+­]¦!1‚ã%Ğn,L‡·kŠ™\n.©uHY¦«3Vå7drÚ±Äª¹\\)êKz«0\\W+Œê ÎÕÒq—1ezwµv”æ«–’J)ŠÓ®dB¦æÊH=ªÍ¶\n‚ÑÑÒZÌ«ÊÑkF¼¤¢8Ê7£-ÂÓ8l‚¸ª2ˆ=u@Ş)uï¢L³WbDqô#ÇpªÊ¬´mç*ÔØ>7…]˜P*Íƒ•È­µpí´UÌj ÆÂ-mÕJ*4I+–¬q[¹Xœæî>ssPM^a8qµ“ßU¶=	¦°¶[)£\$]ˆ•×h¬ëj4jØÆÖ'y/PïA j„àØÑ+`å•Õñ\\L¦µN8šF•£·–å²ªª4•ÓHpÔ\r¤ºÄ…}®fĞ5®šæ*b™ğ‘:¦š•*á<°rœ\"ÉÁ.xÓ„^:lWQÕv(¤§v‘ZGuvÍ@öj·?ª1Î °@ú¡Ğµ}Õ_|GOwµélj†]!v¿­x±AÑtZó‰wwWz*çÓ«¶8:pİ§~Œ7(iÒ\0\$Bhš\nb˜ /\r¡´…°óÃÈ]XÅqİœÇÄ–;S]ÇÍ9'8±TÈm¡Í9ƒÀÂ[ğr`AÔ9&\0Ã	“a ğ†|R ô j€3Ï	,,…Å¬õ¤Hx™Ï±ù<ğğ&TÂ¢İS1L†U6TêŸS¦íê5ÒjW×Ë¥X¡±p€£¬v\"ˆ¡˜3ÄˆMÛP\"Ğ®7Å‚PVúb;Œ¨Ì¹¶:¾Q*ĞAP7\0Û	ÃÈ ªt:†0Æzƒ˜f¡°Î‘˜,=Ê@†Îaô>lµ\"Sä\n˜)1ÙgÂµ]ƒAa\$ñ“øì®#ÂÖ”ÑâU¸)LáÁ)Pí%ÃÖ¢4HœÉ'rb’AP)àÈ˜;0ˆ3ĞD tÌğ^ç\0.%s!1äÊÁ|Péº\$H¤Á>‡ÆaÃ¨^äLØ·dR´¥J²5*ãR–ŒqT‹öV—i¯G%¤,´¯âº6[ÍW4rf«QH	©¬ù#Â“àrkQ88˜DŸ¦ˆaša–jÍy³6æìßœ33¦iÏ:Cté‰ñEPO@Mç`!¸:OhˆÀO okG´GğÖwCJxLQşdÔCù§Ñ«FKLƒ™µ\0£Ui·i*U¾GRÈ. òÈW,­D•„{\rt0†9Ü¨\0w<Ò01Ğà˜¦\0r`-h0†j:\$4ˆ‘R2GCêô}es …€‚\0ÇIâ„î!°9Ê7¥  (‰Êp9\\£ñOTB¸¼Cl‚€H\nº¯8Ù\\£Ô«´ña’@P[-]­7'PC0İ2k´Ã=‡€ñCÌz+ZNÁÈ:CÓÖwÓ›%!ŞèŸÅÑ@×9! èÂ*­…•cgŸ—é”iw\\ãö¨9§™!ñôª¸8Iê>ÓÚ}¯'Ô1†Š›\r¦À ¯¶Dî†0ÃãEÅ\naH#ã`ªìû«„¾;>3XĞ•â.^ªR…¢¤t“’Mm¢'‰Šçğ­Uå<İâõ¢UVEUz¾ÛÄïBª}Xõ™ ”\$¬Ú«e·®Ä7ªİD1Ìo4‹ÕcÖ¡od—UúÇmĞz†‚ø™B)’*³IªĞDQ¡œ]@,¨RyÇ2úá\0PI aäë‚\0ÈZÕØ ‘B¥ŸS×ƒˆu=IÌ3&@Û1f=5Á‰€1’”Ùdo’y=&íÏ44isŒªc œ…\0Â¦]†ÎãMTƒucÍÊhIWÖ‘YZ`Íy,·›cWÄ±1•ÊIf`n†°Ü9OJñŸáÉ;–¬ÿ±Éq•šVw§W>àäÀIÉI+¾x*\0¦B` †±òÒ Œ-œ'kA¤Ñ§{ñ£4vƒQÌİªGcYÜLX Íë‰PúëLWË{õ©¾Œ±ÂVQu{çEƒ•ŞD¡Jî]%>Å1\$ùÛ\\¾R½/O‡½^6 UãÃ{‚»=[¸Š¯•{]nãÖÏ¨¼{mIØsn3°µ\rêÃ{VSí°ã¹óEgêR€†¸C`+Ò¡¤1†¸‹	\0v³z*åÔÚ”C4ª% #\\ú›Ó‡ÁT*`Z\"<ÌÏé¤<M‚Ã~³'}=%loÇW#Ş·RÕæ)XT× Ë<½ì=®ı@z*01ºŞŞŞ´YíÇŠ ]0éãc²ˆòcù>qÕMtVÇÌ¼Ú5Å› E1ÎdƒøïUEñş3UÜàgda¯H\n	½Ÿ´»O>AïG†3îëQ^ÇŒæ2•P’… Ê6refõ‹¤MĞ/ÁY!¿,™¬úd¹éÄâI1o¥±ÍbvÜP­)~ˆŠ¥NK,åmtÆm¶@˜%F´\r¤ÊM¤Ó˜f\nb.Ø†*×/di`K/¦~ŒXöÆ„ÔŠ8ïˆR€òë¾@¯6èhğ4k¶^`¦ûàÊ®Ë¢1MVïbR™&VîšYïDıœû0(^LXôbJô¤îüpröZÍÂÈ¡&ºÖ* Ø©l:LºnÏÌÍïdËF”ö¦u«uP`ó°.ÅæE\$|ipiøü";break;case"th":$f="%ÌÂáOZAS0U”/Z‚œ”\$CDAUPÈ´qp£‚¥ ªØ*Æ\n›‰  ª¸*–\n”‰ÅW	ùlM1—ÄÑ\"è’âT¸…®!«‰„R4\\K—3uÄmp¹‚¡ãPUÄåq\\-c8UR\n%bh9\\êÇEY—*uq2[ÈÄS™\ny8\\E×1›ÌBñH¥#'‚\0PÀb2£a¸às=™UW	8š»{³®#+œµ&Õ\\K#ğ[Šá[=ƒæ-¶¸šO5Õ,§¶%Ê&İ¶\\&¤°TÔJ}Õ'·[®A«Cİó\\¶Öğ‚ßk—%Ä'T¡ßL¯WÈ½g+!‚è'òMbã‹CãĞù ¢É¼ê 4NÆQ¸Ş 8'cI°Ê3Œ£˜@:>ã¨à2#£è:\rL:#ü»·-Ú€‡ ¥³˜·EÂMªğË˜ï³ÅÁa9­³~Ÿ¥NsL©é¬^\\.-R\\Î\"¶ÓC²‚¬CEÃšÎ©MÃRé:³¸‚½()E¸Ï<œ·äØ)¾CHÜ3§©sr”ñR†7Ë!p´ÅËb†LB¨Ü5¾Ã¸Ü£ä7Ià‰Â#æúƒ|úã @9ÀÃ„ñCğæ;Ï\$(Î¸ì“(¶—34ĞÜ#mSAºJs„¯±œØª,»pòA\0b‚)±İ>Öªm«/Š:¬\$ÓJËR’‹˜ç\n;ªÓ~À&ËuUÉÈ* Ì9lô\\SÂ,?#ÆNƒÃD’ôN\\ºM¼ÙGRš®\\ÌìÆº6Ê\nH#Ê\nœò÷jß&4‘İè‚ÅµÌ{8éú†™Rõ!*¥µ¾éL1	pNYË52´-SRâ‹hÅ.zz´Æ—ÒŒÙñU5ŠŞ)ëÑCêv!T(´ZÜ(ju¾8ñ<+/ «â`Í ¥œ ôV‰òÕšâ-Vráçn,¼ò(©”­|5r|„\$›B¯`PJ2 ü:‡©`Pó\0O°¡xHíÁ‹ µ(-É‡2RÊÕ^º+­²Ù/hJ\$,Şçº¡’‰î¡\\uH ³¯Eí/4¯!¼–3¤î°)íı!'¹e·£EÍ:şØ&öŠƒÄV;â{b®{ÑÏF\r`‘F:¿b¾-'5n³ö­Ğ ¨6X\$	Ğš&‡B˜¦Ô[˜uŒDú.Ì¡Ax¶×«\"ï/|Ælîgt;ª‚“¯@Chê9ĞÁàÂºÃÊ:£”æ0ÿs°ÂAà/ ø?'èÃxnÁ¤3¿Ë\0`Â	ia'¤„OôO	Ğ7Aƒè]„”<  ÜÃL	Xl¨5g*“\0PlÈöà@_´!Á˜6% Êr‹+Es£6²#âè3®JVt‡MèT\rçÜ6¿Àò¬'¡Œ1 æƒ¨l°7†t´ÁbQ\\0†pÃ £_µ-T\n˜)B	(DÆ©ÎDoë5µ•˜à^\"Ó'Pø¦ô ÛïKAœÉru!ÈAò>Ø3ĞD tÌğ^å€.2^'”ğÁxe\rÀ½@ÁĞé\neØ\"ÒõÉ8!¼^˜\nÀÑÖ~y\nV*«E\"aEÂ–#‘óš¶lÚ[;7Mjf²#¼ï‰‘ÇW¦àõ„Ôü‚ƒ‘øQÊ@96HKöRR„0Ê0Ë)e<©•r¶WËg&¨.–òæ]ÂHM\n H/OĞ\$†Ğàƒlº“	Q”Ûa„5Ÿ@Ò£¬U“!¸:<gRªb#	T…“«ãV&A\0S™P&E†ƒèC¿ €;ŸØÄ pN²@9Q–ÀC4ğPñn.‡8¿ce‚• :|¡Ã\r}Q ÒCd+/l‚D:§Kâ³ˆŠˆ„c²×\\ç®P+UFŒQ@\$\0@\n )Vaë«R†wZ ¸\$MiMªšn^\n);P 7Išƒ\$Ğ÷?'ìşŸğÊØPrˆ	(E\rZ# w´èRnGÒlÒ;w¨Î›Izäbu¤È\n~‡5`šsA”˜7í<ª´ôlİ†0Ñàd¨\"¯@Æ_|?^Ó¥|š¥öÖÕ,Ñ)… ŒØmÉª·iBß.¬+Ùå¶¨Áõ¤Í9o1~\rRu•(_)AVjÅŞ–Âœd™ı<¥!R%âŠS!A2E€Õ›KşÄ‘rs]ªM¥0’+©×vç2\n€ ’@ÃÌ6’z×(yuHPj~ÁÄ: “¸m’²ÒLÏ–œÃdOõzÖ¨ÔmU¶b(–Æ#»òT¦ãGF\0Ÿ”‡Mù`Z†º”`dH*—)Ö=¬ÃŠ¹×¨Ë–ì¿fVU/pH‚“'\nS•ëÀhmQk2…îlIáí=÷}9 hÉ,á½Û”ä(„ÀAàÉüŸ¡*XgøØMQpOälšy…WA«kæï’ôãH„`F˜ÂT­–I²!ß4I©­2Ü j“GVŠ7w”ÎnpIMsYÈ§fDª°×p»6Ù-UœÒ(.ObÈ”Œ¤É}ë†a°äÒÃ^o­·”¾F8Ä‰‘?\"º kKßz†»P*…@ŒAÄ“˜Í-“Èä‰á Õæt í•ù–µşÎ­yXY©dÎ“˜‰K–È¬ğm@PM¤¤3jÎkRUK Q78‹›0c…:ˆ| ‰‚loŒëEi•Š\"ä¼©fó‡œïùºì]áÃ´V—¬n¼(;ÍÑ¼’tO`oÒµ<(øºÌ³’n—•”\$ºÚDÙ%ú¬ĞÖ2)Zó¶Z<&dŸêƒiÉéXp±	2{•×Cš'¼5¢ÍÖï¼ÍÃu›i˜ }†TMÕ=\\á)\n(ÕØŞñC	N›NRˆ";break;case"tr":$f="%ÌÂ˜(ˆo9L\";\rln2NF“a”Úi<›ÎBàS`z4›„h”PË\"2B!B¼òu:`ŒE‰ºhrš§2r	…›L§cÀAb'â‘Á\0(`1ÆƒQ°Üp9bò(¹ÎBi=ÁRÖ*|4š¤&`(¨a1\râÉ®|Ã^¤ñZÉ®øK0f‡K¡¾ì\n!L—”¾x7Ì¦È­Ö 4°Ôò¡”èk¯°¸|æ\"titò3-ñz7eL§lDìa6ˆ3Úœ®I7›F¸Óº¿AE=é”ÉŒF¹qH7P–uÊMÀ¢©¸Ön7äQ#”j|aÅ˜Œ'=©¼Êsx0‡3©ÀáÂ=g3¼hÈ'a\0ê=;C¢h6)Âj2;I`Ò‰¸Á\0ÖìA	²jŸ%H\\:\$á„¢&ã˜Á0@ä·A#HĞÖ Úí:£ĞÎå#Í\0Ø4B\n’ã(Ş¡ˆ›S\n;I Æœ‹ÀäŠÈB#^½¶cHÇ:îÌ-#– P¡ğDy++“¸ãCĞ›ËÂÌÉ	0,Œ‰c:3„ä<µ\nw3D‘8HÁ i@†1Ë†\rÉN1Aìèäˆ¹iºØ0B`Ò‹µòÊÊ¹c+4¬…¯¸æÅÇˆr ‰\$íK‚:¯²eJ‡¢1<ì2Ô(CÇÖ	(Øç…Ó¬â0µu¥E[¡µÊ'](âËK¹îX¦‚ t9 £8\\0…ÂØóm\"è+\$¨%<SÍï€Ú:Ôa\0x0§ağäÏ£’EÁ.òã|]wh†àŒÃHÏxŒ·Åô>âvŸ\r#›ÖÀ(Ót7aø@A‰@#(ñ\rÊó‚9£”µFÉ¢@PÙ F¡¢chÈš,© æšBÃÔD:Ãª‹”é ×˜,ÙSÃõbéˆä:·#5¨é:,÷¸èPáåå{; Ò5¡c›‚á„àÖáZˆİ(¸Ù°'éZdä²Á) ó¤lM‹µ¬£‚È­¢P”ˆˆ&ŠNhš4TS9,£(Ö5ÉMÕb°]HXÑwŒÁèD4ƒ à9‡Ax^;ô–¾ş¢Ar43…é8^”âƒ Òà…á|õpÅŠÊº#„_5ÅâÊÈ25÷·î-Èç%jŠ<º2¡`@6/ ÍìÛB0wz¶i¾â–3]î2Eå——z½çWc¨\\0dŒœË±~fX³Ó9u„¸Êæ\\Ûsî…ÑºU€àÛ«u¡¹Ö±²NÇ `\"]¨¡— Î^3‚JÏ}ä/äDYI8æxâ±pØ‹ß±k\$l‹6E‘BÈIK£s.£`g\$ÄM»šÓÔİSw!a½ä‚œ)ÚÃ>1o±´fŒÓ\"¥•Ù,pÊdƒ\\U#Uäş©=í˜Š¶²D@P9•Ù\$ÂBDI('`¥ş¨¥DĞñC(¦¤ ØßCÊ\ne±ŸB”äRP¬_>&Å¢fhBİÀŸB®ü…–8I9#0±ÅäW \r°ÙC˜v²KphU`ø6ôdŒÁ\"’ªX‡Œ~–¡ıQà€;¨ÆŠÈ¸gs„°ÖË3[ ×@e#’tS‘)@@C\naH#G@Ôg•[ïÄis¶WöˆÉÙ#„x)0I\"h­…©7Î›E‹÷ˆÌÅ·À@«×\$H>‘(Ü„PL_AA¸™X‡! oĞ Çp©Ã”#±¶’ÂdÃƒËEx\r€ıEúÏb/ä¼p Â˜T5„L¯=)ÎN;F-”yŞr€L\n	.Š˜‰#2¼„C¨y`d‰. “ˆïº%odŞ`©§\rAiˆ^RAy\rÔhS\n!1ç	åUI´‡\n4ßŸFrQPa\"QF´â³‡Xäù¡#†”ÁC D%Et&†‹Ã\"dã*¼7ˆ:1““^qlİùĞ¯ôF5v.ºÂK*Ÿ±â>¦?L³ù3d‰'¡ZÒlq|¿O\n>OÉXU\nƒ„\$Ã\"~ÌÑBhPM!]‰M–2µÇŠÚİg©4kjşÉÏ	qiŒY¹\nîå\"‚â\\Ïcú6K5'” P\"…¨Ü²£fJy±9A2”•Ãgb¢´.(”^“e!ä’fNü!86…È0aLÍ£4‰ÏNê¹|4–2NˆÚ(\no%¸¼<¥V§Óµ”¯vE`ë†›‚šã\"‹4%†ğàB’ğDh\"…]\$NG¤ñÇ8ºë\$Mop=FÆ¡¾Á˜4M…Ixj0Šø‡ ";break;case"uk":$f="%ÌÂ˜) h-ZÆ‚ù ¶h.Ú†‚Ê h-Ú¬m ½h £ÑÄ†& h¡#Ë˜ˆºœ.š(œ.<»h£#ñv‚ÒĞ_´Ps94R\\ÊøÒñ¢–h %¨ä²pƒ	NmŒ¹ ¤•ÄcØL¢¡4PÒ’á\0(`1ÆƒQ°Üp9ƒ\$¤ñÕü&;d…HÃø5õ}QŸÄ\$¥öÑCÆäË©üZ‘„B¡‹	DŠ8±ˆÄÚ(iÍyA~ŸGt(êÂ‹y¢g£²Yã1~ÍÒš(ùëBd–Š×¯K‹–m®JI–±Š\r.(²§èV­¼V1>œ#ãë\$:-ÀÇ÷r%C’—ÎÇ´)/–½ÕĞtép­^Ö\rğ„â>”[73‡'ÎòÑ6ªSP5dZ¤{îh>/Ñ ú¤êz0è)28Ë?ˆÊvï(P|\"ùÀo¼¦­KBÚ\"i{* Äô Ä5Ï²¿:ã¹‰úĞ²…‚¼H£ÈÓ8Ş£‹\"JB¸®Z€è–‰£(F‰)µÊZœ’Y(‘ˆÂ\$×&’Y¦¬£ç6,«X\\¹NÛzÀ#¼‡æ‰ÑDŒZ²9«Ëª±)é›Äµ+Å;DšLh1(É3Ïë É(1@İ·¬£lhQñÉ –MHªŸ>Kò X Äšü‡!™¨Ğ°q Q&«ëˆß1ód3WÁH³\\Cº%•-£‰’E5 ÄÕsEÊUë\$C Äû%-\")ÊQÔNáZHáx·pÓùC:pÊ G6ğ‘:£Õ²f£\"0Ğ*©xŞi\\5{ŞP…õW¸4ß Ì¡pHáA¢Ç‘\ratƒ2úr·¥ªP×6kZ×š“AVÄ°cwGV1B)Š©q¬Z\"…£hÂ4„uµIú%!Ø8Ÿµ,œ[£’ŠÎĞåÔÙ\"Ögn.‹BÑˆóº¬ß¬5²ŞÕ–LG…ÀJ¹¦'‹&Ÿ£Ìpş©ÄÔ}­,n»¯ÁZjw±ĞÛ.§|(vÕ¬¼ºƒHÑ¢3Tš˜th¼G(2|ZÉ±xuË¹Tg–Ã±V­#Ü¬ƒ\n´o0J´Ã½hç‡xÂ%İ/O¢iÖ=_(½g?¥\nÂ´á&¨c(ÁJS@õ\"íe=ã<J…_0¿èÌõ>/ÛkÇå³è¿‡ï),Ëƒ å•;iN‘O£êö9R¢Ï—5mèn¬’J6=óœåÅôšGQQì)1CÒ~,P¼h†9ˆsAOÑ'£º¨ŠÂ“T¤);/ˆe‘Z‡mïÙ¹“ÒLÿ—óü„ïü‹@E	¤B\$BÀ±F„z°IO§=Î„20lŒ¶x>MOa;©?ˆW\nPšl(á\$\"¸J!Œ;†ÚC¥© ¢ìˆ”D4%W”G\"‘\$^¼EoI¹<„	Á=Äëa\"3DL¯“xL‹Q6Éœhˆ’xš’™±J§&=DÂC m\r!¸2‡\$Îêa2\n3pö=ä´é \rÈ2†`zƒ@tÀ9ƒ ^Ã¼±Á†HÉ9*ƒxrà¼2†à^xn!Ğ4Ì^A0\n»çhø*±]‹è’#Ô¡9’ğñ0&%(®„„W§D–4g’…ãÃâ9D.2Côİ\rÈ2´T¥8àÓ®¡OAÇ‡ªìü•&ò–YÑã&ÄP´œA(¥\$¦•ªVJéa,¥¤’’Ê\\K©y/ƒ(x’ô9ÌY|¹§!DpœóÎTÎt'åc“Ôÿ!\$4N°í²XC…™<0Ò)mD¢ûÊæ: Ù²a,¼Òªkx‹%·²SãìÒFh(Ÿ\$è@¨h+¼6¥í\$öÈxÒ¬Y*	îÓ˜Pt!ª\0¢Êt¦Ó5;S±E d`['#ÖtU (ç^&”hømãÙœz©å=’Túµ†À@î\n‚\0 €-°o^ÃTôÂ\n\nĞ)¦é(%#;\ny5rK§F±\"Q}0xO¥pN-Ckuò@ct[í7Ai*+º•`À²{©¬Ÿ˜>WŒÊOeµ.=ø’P²¢­2d¯\n8ik ¹N+ıêÒRP•îT·?“R“ ‘-H(u*Û):cÄuÈ5‘C\$¥>S\nAô³×³Ctªé•5—v‰D†9n[ÇÓ†Må9uŠF}'_>®kb#ıj“£\"“\r§Wf²ÕBú‰Ih3p„Ø…1¨dÌ»©ÀKéé”şW…y¾±È½Újw…Û,v4eúó¤gÂHc¼¢RVKäbegã	£\":,Bua=qÔğ‘±BgôGHTISWŞ®/,pO\naQŒ9è_«\$\$Gâ#™ˆY¸xÂÜœi9îåËU¶z¾YR±‰©–x\nàî>¢(‚Q¦R*^7R²DqÆÈÊøñ\"H‡_Œ!Ìe%õ(1v˜Q	‘–~—äì‚ P=6àÊvåÕã©Vê³GuÈbŠ4=ëµEŞ£CYÑLq<\"ûa‘ÅÜ v3r)³Uìİ›‘ÄË‡É03¿µvaimÄm<±²Û=ÂÛ\r¿qìuÙ=,cfogÇÆ½»v”ìÜûÉ~ïE˜ÀIpC|Á°ÚúğôtÊÿj˜,÷~ÔEŠß^mb Ÿf§“‚ãOj§¨0Ü6·w8*…@ŒAÁ.ƒÎ\\Ş#±u´^nµ·Úá¿}˜¿\r×-W\nßmóm­á?#æü­Lì9[*î::ÙÒİ8wo”{Òğ†¦¦†W¤P+=fˆÒ.Œ·¾¢S 0Ñà¾´XšH:ñÕK€Ş¥4’*A:é¡œ=\"gâ ¥vßdÏX)Œ3CÛÂŞu‘\r¦›œk{_§°=?ÖpUÏz,âİøîÉáÎVrùa c?º'êh½DIIğêâKÂ4òÊ–.¹Â°çJkØúîŒ°\\Ó,jJŒh,¦v¡û¢›¸êôÒ\ráúbkwqIMŠ†%ó<—:İj+A\0ç‹Ì€_YKt\\tÀ|§ÓÕ>£·–ÊjòÀ¸";break;case"uz":$f="%ÌÂ˜(Œa<›\rÆ‘äêk6LB¼Nl6˜L†‘p(ša5œÍ1“`€äu<Ì'A”èi6Ì&áš%4MFØ`”æBÁá\"ÉØÔu2Kc'8è€0Œ†cA¨Øn8‚‰'3A¼Üc4MÆsIè@k7Ï#‘ø**'®Œ'3`(•;M‘”6,q•&ƒ‘¤å¸’ğÆ™}Ä£+7áÌ7ÓÍş:B:ˆ\rW‹Ô.3²b\r­€ë4‘Œ† êq×ß/Â|\0(¦a8è¶Û‚ò :`ğ¹*æ{Vv´ËN’ü-Ço¹¹è÷æ³)æÅd‘gx¼i£wĞ7MçX('°bî%I„ŞyÕÄawu¤Ã:›DŒ°Ò5£¨ûğñÄ0Kš82cz†(²ö‰­€ì¼À£\n2ø#ŠĞØ—¼C˜X³Œ«:\$Œ›VšL[<Ÿ&¯{â™ºê\nn¢*2ŠMÄ4¾7csXß¯#ˆè%ct€\$nÛü5Läñ P2­)s\n<Œ/sà½&c¨ìô¸«\$Â£Ãªr98rôf7LS Ü´ P¡®¬SšïƒzF4+;Ôï-2ƒ(ÛÈá*“# G\"‘<€œL«h¨\\tøb\n#J7=IÈÚŒ³Q”ºÛSâ!* 7ÀP‚’J)›t\"…£€Ş°8 S6År@ì=°õq0@P²:¢µE(2Ø6Ğà¡¶£\"˜#au&¤Û‰h[¶­Á«£ÓÛ\naĞš&‡B˜¦ƒ ]U…ÂØó\"ì‘ğÈäÏ82S¢FàÂŸÊZD;ŒNÉ*àÒã}V09„~H4½-XA‡b˜Ş=>C>9#±ƒ<‹=,*Æ¿;a`Êç±ƒ©R1Nt†2£Œj\nH°òş`ÀT?hŠk(@7ŒÈˆò75mJ:)Œ£í°U Ó¥.\"RÖ-8à¢LCÌ›iRàèÔ´š:¸¾Dt£W¥bÑZ‹gxµ\"ÖLËjíYVÛ·»æÜP	^ñÄ¾cFùŸ);şÎ&|OÂâûÏ±À<–éÊÀ¨cÒò:ë*: Œ‰àİ°„èéÄğC5]˜Æ‹¬ÒµÉ¥b4##¤G‡5£Ê3¡¶:˜t…ã¿´#]¶Â2#8_…ã\"¼•*ğ^Ïàó-µšSüâãxî?§\"(ÛúøÊÉ\\nåô&RdFÑ0D½1WJvßã³eĞ Àäƒ «%ğÀ@N2~'Šù1“Fñ\r;>dÔ9‡Süga„yïEé½W®ö^Ûİ,O}ğ¾0ÜøÃÀtD¤‰õ& †‹Ñ2jìiş30|ÿ •b¨Iü¡TÄ†\rH<dÀ™\"Ä%	ˆaÔd.Ì’C~É‚8`Œ3&à^\\›u%gùA'·Ëg ˜šÈXL)\\+“&ŠkÒU\n1Q\n!h°Làì]@\$HÑBĞtñèàRkC)`ŒÆ#¥ÈRÈèI\r¤¼Ê³dX4J…ÈĞ®D¢NJIYl\$ÀŒÅÒ:}C¡àR˜Ö_êz1‘qĞÁdÊ‹y\\Uªj¢0ÄfIR\"e½ù–àNØn—ìaLBÂ˜RÒè˜±˜<ÉÉ3ÎnåÔêa(%D°—LÂh†ß3\n/¬¹›±§ôK— 	(|‘ÀÆúÉ(,€ia™Ù®è ¸v3ÎÑï'=Ÿ¡›…-C¤GE%E„›ã*[m„­n\0Â¤j\r‡å‚—È<€©Ú/‡j\$)]š=d… 7`ÒÓ3–ŠJ[òòvHd¨ó&šÀ¦Ba5&î(`©%Œ‹„8ˆ*Ngƒ›altyĞ’5„‰d%cO³9ÀXˆèEQ*,7ÆqDƒdƒ°J)F÷„|¬UƒQî.¶j¹,•…jàœ=QS™e—-³1°‹YÓ'gìJT¡åä³{9g”¤4ÄĞ!‡C\nÈ©Ù¤…P¨h8,á¼2)¡ØÓ \$^Lû]¥ƒ&‰pÚ-s•Ğ¯JÈ2îÊ8\nø‰D\$FHÙæµöA€ ×Qa5æçX°%ĞšiàafLaÑ˜ºV±\$Õ›×^-Œ(&—øášÔrƒS½wïİ„², ¸q§Tğ–VÃt´ëiá<g”ÛÒÄºÃÁ†,€(Ì;²h‰y›a…&ë™¬d:½aH˜7,`ØW•ù!®éUd2ìgtÃuÉÏ5M{nıáT˜á Em/‡1v¤\0";break;case"vi":$f="%ÌÂ˜(–ha­\rÆqĞĞá] á®ÒŒÓ]¡Îc\rTnA˜jÓ¢hc,\"	³b5HÅØ‰q† 	Nd)	R!/5Â!PÃ¤A&n‰®”&™°0Œ†cA¨Øn8‚ˆQE\r ÆÃYˆ\$±EyŒt9D0°QŠ(£¤íVh<&b°-Ñ[¹ºno”â\nÓ(©U`Ô+½~Âda¬®æH‚¾8iŸDåµ\\¤PnĞÌp€âu<Ä4ƒk{¸C3‡™	2Rum–£´Ş˜]/ãtUÚ–[­]á7;qöqwñN(¦a;m…ƒ{\rB\n'îÙ»’í_ÖÁˆ2œ[aTÜk7Îôƒ)Èäo9HH†¡„Ä0c+Ô7Œ£›67ˆ ê8Ä8@˜îü‰†Šê@à‡¢¨» \\®ãj LÁ+@ŞÆ»Él7)vO„IvL®ã˜Â:‡IÈæ§èÚfa”kÂÃjcĞ]’/ÄP!\0ÎÌdè!ª K P› k¼<ËM\0ÎÃ\rêà@™Äh4 A³N!c3’(7\$ÈXĞb,(„4£ÊBŠ]£ƒ\r>¼‰J NÃÆA1‰¨¡[¨(¡RÜ„ˆA¯°åòƒ,™ÒôÍÅÑ\"OC¢òxÂ70ÌCŒ‹Ğò:¡@æLpÑ(`PH…¡ g`†´Xé\rn~Å/e,1¢Làa”MÃ]èØğêPTêV‹ÃŠè\$&ó¤á»c+JÎIªÆ]‘!Ô0#d•CJ5K,ÊˆOs—dJ¤w0Öa•P}U‚N”ÚrÊVÈÃD CÏÊä²\$	Ğš&‡B˜¦cÎL<‹¡hÚ6…£ ÈSÔÊ²ìÎ\r£¨ç‡ƒ\ntC(è:JEV/°Â<‡xÂ\$9î~!Äã0Ò3èƒ.›§ÇAµ?CLl1\rt?ÜÿlºîÓ³Œ£Åh7cLOOİÌ9Å#@6-\0P²7³ZL7ŒÃ0Øí©¶PÉ·yOV»¥èÏ©K‰†Z —¢›¢êÊ¾4Ã«¼ÍâÍS46E`@„rjôõŠR/3Xt6a—PHÜÊŒ)	 ¡Ü¬<Dã:z4Uc\\3m9Ó´†# ÛÆ]pÇ»##êg½~‚3¡Ğ:ƒ€æáxï÷…Ã­ìÏÀÎŒ£p^2Dïæìş>¬:=6¶Ô\0PPbÊŠ¤vIù-Géğèë‚MT\n`Ù)¢6íJ[QÊA)6\"ëÎ¢	\\\$ğPĞøß+ç}/­ö¾ğîü_˜n>¯Ô9?wòş“ùn¨œ‚&~aÏI_\$”›@èÀ’Of‹A\$0æ²,­—¨FA,C\$\nµÇQ8 ëÔ6¤«ĞA´2«Â• rAAŒ1ÆÌchl\ré<¤F²IĞ6…‰ ½àİCloÔ¡¤(¶‡Ê]\"Á#DÆVİ!_É8‹¡n‚B€H\ne¢.Ä¹\rFI’†öÀ”Ñ<:ŒïL†Ë`àƒIÙl¡:Å´›A2FAxêO]\0 tE¼Ö/G–}PÉ&¡ÍGÖ¼ŸƒDÙ\rÁÀ: ô\"„Ã’±ìZ&=pÎùãtˆ,Hİ\0¸ä¸²H€ƒ:E š„0¦‚3\r0a \$Ôè¨Èã/I¬Í\"!t*Ã«ËYH%Ú¨º´Ô™Š„¢*à\\CÃ9«àQ ˜¤.ÄÚà4ªY/:]Î!1N¸4Kâ*N÷D(†*&¨xu\$„\$0òáSİ™Q€7+2Z	§@¨\$3s¤õ^¼:D9ü–)€ebBı3GfJI&Ä|…\0Â£¥tî²”BÅÈìRqÀk ‘ÄÂ¾	a.#tÔŠr[Fàáb\"‚–W1X¹C©#,eÛ#ª†æ\nì–vdF´‘sˆKÈé=J(»„`©*Îs¨¡:[1Œ(H\$›fg™š‘š\"ÀÄ‚\\yyá[™iB(:€–õ.N‰º“\"	’v–ÀªF	ÈpR”€†Z#m©Y°<¿×—NZ”P¶'%à˜d{%ËyKĞQÊÅát,LjURE *…@ŒAÅÄH7‹[Fdˆaë2ÕÛ)L%yË[Qµp\nŠDTéJ2«ˆuhò¼C€£r‚%¤6Nñáòjš,á¹ø¢èİëaxØ‹3dÜÚ3eq°­fbêPH*³dWü-+\$„²è )¹Í(RéK{7¿å±~‹±«½­¦ê,%at³šP”ÜK²V9¶˜Ë'’^\"]î6.c9˜(ªd0G0“JŸàÜØ@";break;case"zh":$f="%ÌÂ:\$\nr.®„öŠr/d²È»[8Ğ S™8€r©NT*Ğ®\\9ÓHH¤Z1!S¹VøJè@%9£QÉl]m	F¹U©‡*qQ;CˆÈf4†ãÌu¨s¨UÎUt —w¯à§:¥t\nr£“îU:.:²PÇ‘.…\r7d^%äŒu’’)c©xšU`æF«©j»šárs'Pn”ÊAÌ›ZE…úfªº]£Eúv„˜„itîUÊÙÎ»SëÕ®{Íîû¤ÓPõ‹g5ÿ	EÂPıNå1	VÚ\n¢èW«]\n„!z¿s¥Ôâ©ÎŸRºR‰‚¿†ÄV×I:™(¯s#.UzÎ @Ò:w'_²T\$‰ùpV¸LùÌD•')bJ¬\$ÒpÅ¢©ñÊ[–MZŒó–\n.Á”¨ñ>så±ÒK–‹AZKœåaL„–HAtF3„ÙÊDË!zHµäâĞC”é*r“eñÊ^”K#´s¹ÎX—g)<·6‹Òør“.Ûÿ\$ç) F­«î@¬„Ìš^’®+â@œó‡2³G)v]ÏC£ A\rRxLëA SA b£¤8s–’*.]œÄ\"h^‘§9zW#¤s\0]îyAÈ)ÊEìttIÌE•21j¡IW'Èé:R9T„ÙÒQ5¡	Zœ¤y#TL¬îX5•h—Â–-@?+¹ÎGC*0\$	Ğš&‡B˜¦cÍÌ<‹¡pÚ6…Ã ÈUUY8°óšp\r£¨æ:àÂœÃÊ:£Ü88Â9Còã|Wö\0!ãpÌ4Œø(ËˆbI¸æ\r8:qŠå4ĞídAKKE{ÿ–åù¤ªDfK´ PØ:J²°Sg9t_œ…ÑÅ“Š	PÊ’´ÔC¬óLÇ”…‰ĞZC¥bâÃ3„:BM,1^[¦ó´fC\$’ÖHÇI…•ùÊï\$?«º£BçA`Q?®Ã´ ŒƒnJ2[+ötĞL’)¬‘Ê—eeü\rÌ„C@è:˜t…ã¿T<O9Ãxä3…ã(ÜŒ˜ÈÂ:\r8È^ÌC,VË	teŠZt”%©ÒN”K	ÊB\"M:\r4)°ÃÜvÏ¹¬Öù2zÕëèû?™eî„úwÍó£/?Ğô}/OÔõ}o7qfí]¸eÑÛ7zíÁ\0?h ·¨Í°¹ÂÌJ’t+„æàr‘\n9D`–gBüB¼Äš\$‘Úzïd÷äbÅh¤ÂLFªbd!Š(¨o\réÂŸñÎ&ÅÂZ„¨B7ÑZz_?nS—AbÌxœULİ–òã¡jgˆ€€(€ Ë¢¢?ğ¤T<bpôŸ)A\$¤œ\\Á<9„p¥FbÀsˆ˜\$d‡8«ëQ˜³œDDF=&,«—±&`b#çKç ¹ Qpw‹0æñÇÕŠ+È`½ÉğúÅr-®WâbD–¤€(#ñ…\0€!…0¤‘Ö'‘³öøjÆY„rˆÖìG@¶¯°\"HI‰D‰Dã˜WUèÜ„y;?c”Q	åF(:Âs	á8c­1Ñ\\D‘qâÛŒZRí³ab òY¢ÍÄxbósĞ)@'…0¨Ë“‘[‚¨˜M&ÎßDy2+Ğô²÷!æ¬×e£¤B©U.9D‰b’B ÆEÏ€{üC„`¨yÁ'°¦Ba=%æ¶sæœÔ¬0,éhœ³šóÌ?1Eİõs2%……@¨TğYÓ\0!O¡¨\"lW òî²ŒıJª‹KÇ4†,G,41b2r‹ÑÚ\0l7rõˆu 'ÄŸ¢Oñ7 ®=Âåál9a\$&‡§h*…@ŒAÂQKå!eDçÕNª„i“+ÅUŠ“ ®©©¯BP\\¯2PTáhc @‰CH\\D\n}J&Øë8b°mKàébú8\nZó^ì½sŒèE\nĞ/dÑ˜lt19Í{~Cğy¯=\"‘â@Üè‰È×‰9º¬h¡…¡\n/Z!AF‰t^7ÒÏd9421E(ÁEqÃ=‰ËÒÍW´–“Rx";break;case"zh-tw":$f="%ÌÂ:\$\ns¡.ešUÈ¸E9PK72©(æP¢h)Ê…@º:i	‹Æaè§Je åR)Ü«{º	Nd(ÜvQDCÑ®UjaÊœTOABÀPÀb2£a¸àr\nr/TuéÊ®M9Rèçzñ?T×Èò9>åS¢ÁNe’IÌœDºhw2Y2èPÒc…º¡Ğ¼WÜÒË*‰=sºİï7»íıBŒ¥9J‹¥Úñ\"X¹Qê÷2±æM­/«J2å@\"ïWËör¡TDÄ{u¼‡©œë•ãtŒsápøÎî‹ÁÕãSĞô\\=\0çV¡«ôïp­\"RÕ )ĞªOH…êıÎ”T\\ÓŠ§:}JéF+üêJVÏ*r—EZ„s!Z¥y®éVê½¯yPê¤A.–ÈyZë6YÌIÁ)\ns	ÎZ‰ÈæÌ¢ÊÊ[¹Ê2Ì’¥ÂˆK®d¹J»“ç12A\$±&¤ºY+;ZY+\$j[GAnæ%ò²J½sàt)ÒP“Ç)<¹9,3r“/‰Ê\\gA2³Á0YD¶äÉv”«™`\\…É:Îä,òè±ÇIA?“epŒ\0Ä<ƒ(P9…+™0æ0!pHÓÁªæH‰šäreÙÌBòiÎ^ÑG1I@x–¥ë<E¡Åé9[%Ä>CÖäÜîV’IZÕ²°_ÇAU+ÅTK¾)i	f£ÅyråÒ=A6ıÂœÑ©™eY…Ùl¥äy|£¾\"@	¢ht)Š`P¶<àÈº\r£h\\2–„IïòıEa\0Ú:c @)Ğ|9£ ê9\rÁ\0ÃŒ#ä0!à^0‡ÁpŒcBŞ7ÃHÏŒ¹VYNBeÇ9L@ÂYáÌDÇ)*Oè©ĞA£’Ú4@Äq,NB)P©.ÛC`è9.lÙÒM”NI4rD2”r…Òî¡Í(Díp\\Tño”…‰ÌJ’í*\$	˜K)tA÷@A\nÇI £ÄaÒC‘§ARS3\$B^Ei›ÂÌ„ùĞVªÌ´T# ÛŸ£—\rÄ6Ds¥rm·‹`Hã\0ÑÁèD4ƒ à9‡Ax^;ùpÃÕuƒ\\7C8^2ÁxÉ™Œ# Ó™…á|s¤ƒJ_,¤AĞEïD±sÊ1²‘9Ğ|¥\nc(æ9ûù^,œG½¹1jÔxmkY8 Çÿ\0Qá=w®ü2¼†ñ^;Éyo5çº°Üë^›Õzïd2‡…\"ŸãàLiØ!ô,D«öhÂX\\Á*:p“+îÍ=§Ñ\n9D`–ê¿á~—…êB­¥4ÃàfEh¤Câ4¬ªQ`!×£Gsb}Ó!!Î&Ñ°9˜sa\"‡ÄÓv‹}ÈQ>-Ì˜0d\$…µ4D‰2(2xDªv•Ğ\"„•…\0|vj±äB>’tı YC\$€ÖŠ5d)P¨°â&šhÜ(\nob\"BFQ\":h‰3&lÃ£e! jsCFIÎZG0 ÖšóF:½Ê\\™ˆå¤‚¨Kño–áÊ&ås”BVR`@Â˜RÀ€:ğÖö	ë°€Ğ L‹ÃZHLåÂ¸ş‹d¼àˆù!\$rÁ\"a\\-[Ø¸rdÖ2	Á\0L	‘kœ(<éQ(SYÂs	á8f˜¸ÆtÉQ|'Lu©ÖsBƒÇ0±PE‘.'‰ÑEù‘:(ŠPP	áL*kÅ ª ôs6Lå9”/ÍA.CóA¨CN„ˆV•òÃ@Œ4B½Tq\0& F\n@•‘!g@‹\naD&ƒƒE›mmé TLX`Ü´\0Pñ|W?ñÑĞ©ã'ğÁ¿óPjŒZ†Q²¾£'¬t¡&\rF8³cbTI¢Bâ ÆÑb:Dø¿3\"2>‹ÑÚøl:pëAÌ'Éy±6u(™qÈ/År(°JX¡Š\n>T*`Z*k+ü§‡e	!®…°ÑR”j–>6¾Ø‰Ar­ÄÉCÂ¨‡'©è›R´˜NbS)ËK1xå‰*‰Ä€äZRÙÑx\"SÅp”Üó_tğ†•¸ 'Ê¹¬ü‹˜‰JøPÕccŠã€\0HÃE½#×pá±^ñH¦è\0UeH©5Ñk‘Æ|»ª.RúaL`";break;}$ug=array();foreach(explode("\n",lzw_decompress($f))as$X)$ug[]=(strpos($X,"\t")?explode("\t",$X):$X);return$ug;}abstract
class
SqlDb{static$md;var$extension;var$flavor='';var$server_info;var$affected_rows=0;var$info='';var$errno=0;var$error='';protected$multi;abstract
function
attach($M,$V,$D);abstract
function
quote($Q);abstract
function
select_db($rb);abstract
function
query($F,$Cg=false);function
multi_query($F){return$this->multi=$this->query($F);}function
store_result(){return$this->multi;}function
next_result(){return
false;}}if(extension_loaded('pdo')){abstract
class
PdoDb
extends
SqlDb{protected$pdo;function
dsn($Gb,$V,$D,array$ve=array()){$ve[\PDO::ATTR_ERRMODE]=\PDO::ERRMODE_SILENT;$ve[\PDO::ATTR_STATEMENT_CLASS]=array('Adminer\PdoResult');try{$this->pdo=new
\PDO($Gb,$V,$D,$ve);}catch(\Exception$Xb){return$Xb->getMessage();}$this->server_info=@$this->pdo->getAttribute(\PDO::ATTR_SERVER_VERSION);return'';}function
quote($Q){return$this->pdo->quote($Q);}function
query($F,$Cg=false){$G=$this->pdo->query($F);$this->error="";if(!$G){list(,$this->errno,$this->error)=$this->pdo->errorInfo();if(!$this->error)$this->error=lang(21);return
false;}$this->store_result($G);return$G;}function
store_result($G=null){if(!$G){$G=$this->multi;if(!$G)return
false;}if($G->columnCount()){$G->num_rows=$G->rowCount();return$G;}$this->affected_rows=$G->rowCount();return
true;}function
next_result(){$G=$this->multi;if(!is_object($G))return
false;$G->_offset=0;return@$G->nextRowset();}}class
PdoResult
extends
\PDOStatement{var$_offset=0,$num_rows;function
fetch_assoc(){return$this->fetch(\PDO::FETCH_ASSOC);}function
fetch_row(){return$this->fetch(\PDO::FETCH_NUM);}function
fetch_field(){$I=(object)$this->getColumnMeta($this->_offset++);$U=$I->pdo_type;$I->type=($U==\PDO::PARAM_INT?0:15);$I->charsetnr=($U==\PDO::PARAM_LOB||(isset($I->flags)&&in_array("blob",(array)$I->flags))?63:0);return$I;}function
seek($ke){for($r=0;$r<$ke;$r++)$this->fetch();}}}function
add_driver($s,$B){SqlDriver::$Cb[$s]=$B;}function
get_driver($s){return
SqlDriver::$Cb[$s];}abstract
class
SqlDriver{static$md;static$Cb=array();static$cc=array();static$td;protected$conn;protected$types=array();var$insertFunctions=array();var$editFunctions=array();var$unsigned=array();var$operators=array();var$functions=array();var$grouping=array();var$onActions="RESTRICT|NO ACTION|CASCADE|SET NULL|SET DEFAULT";var$inout="IN|OUT|INOUT";var$enumLength="'(?:''|[^'\\\\]|\\\\.)*'";var$generated=array();static
function
connect($M,$V,$D){$g=new
Db;return($g->attach($M,$V,$D)?:$g);}function
__construct(Db$g){$this->conn=$g;}function
types(){return
call_user_func_array('array_merge',array_values($this->types));}function
structuredTypes(){return
array_map('array_keys',$this->types);}function
enumLength(array$l){}function
unconvertFunction(array$l){}function
select($R,array$K,array$Z,array$Dc,array$xe=array(),$y=1,$C=0,$Ve=false){$qd=(count($Dc)<count($K));$F=adminer()->selectQueryBuild($K,$Z,$Dc,$xe,$y,$C);if(!$F)$F="SELECT".limit(($_GET["page"]!="last"&&$y&&$Dc&&$qd&&JUSH=="sql"?"SQL_CALC_FOUND_ROWS ":"").implode(", ",$K)."\nFROM ".table($R),($Z?"\nWHERE ".implode(" AND ",$Z):"").($Dc&&$qd?"\nGROUP BY ".implode(", ",$Dc):"").($xe?"\nORDER BY ".implode(", ",$xe):""),$y,($C?$y*$C:0),"\n");$Rf=microtime(true);$H=$this->conn->query($F);if($Ve)echo
adminer()->selectQuery($F,$Rf,!$H);return$H;}function
delete($R,$bf,$y=0){$F="FROM ".table($R);return
queries("DELETE".($y?limit1($R,$F,$bf):" $F$bf"));}function
update($R,array$N,$bf,$y=0,$L="\n"){$Rg=array();foreach($N
as$w=>$X)$Rg[]="$w = $X";$F=table($R)." SET$L".implode(",$L",$Rg);return
queries("UPDATE".($y?limit1($R,$F,$bf,$L):" $F$bf"));}function
insert($R,array$N){return
queries("INSERT INTO ".table($R).($N?" (".implode(", ",array_keys($N)).")\nVALUES (".implode(", ",$N).")":" DEFAULT VALUES").$this->insertReturning($R));}function
insertReturning($R){return"";}function
insertUpdate($R,array$J,array$E){return
false;}function
begin(){return
queries("BEGIN");}function
commit(){return
queries("COMMIT");}function
rollback(){return
queries("ROLLBACK");}function
slowQuery($F,$jg){}function
convertSearch($t,array$X,array$l){return$t;}function
convertOperator($se){return$se;}function
value($X,array$l){return(method_exists($this->conn,'value')?$this->conn->value($X,$l):(is_resource($X)?stream_get_contents($X):$X));}function
quoteBinary($rf){return
q($rf);}function
warnings(){}function
tableHelp($B,$sd=false){}function
hasCStyleEscapes(){return
false;}function
engines(){return
array();}function
supportsIndex(array$S){return!is_view($S);}function
checkConstraints($R){return
get_key_vals("SELECT c.CONSTRAINT_NAME, CHECK_CLAUSE
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS c
JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS t ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
WHERE c.CONSTRAINT_SCHEMA = ".q($_GET["ns"]!=""?$_GET["ns"]:DB)."
AND t.TABLE_NAME = ".q($R)."
AND CHECK_CLAUSE NOT LIKE '% IS NOT NULL'",$this->conn);}function
allFields(){$H=array();foreach(get_rows("SELECT TABLE_NAME AS tab, COLUMN_NAME AS field, IS_NULLABLE AS nullable, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS length".(JUSH=='sql'?", COLUMN_KEY = 'PRI' AS `primary`":"")."
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ".q($_GET["ns"]!=""?$_GET["ns"]:DB)."
ORDER BY TABLE_NAME, ORDINAL_POSITION",$this->conn)as$I){$I["null"]=($I["nullable"]=="YES");$H[$I["tab"]][]=$I;}return$H;}}add_driver("sqlite","SQLite");if(isset($_GET["sqlite"])){define('Adminer\DRIVER',"sqlite");if(class_exists("SQLite3")&&$_GET["ext"]!="pdo"){abstract
class
SqliteDb
extends
SqlDb{var$extension="SQLite3";private$link;function
attach($n,$V,$D){$this->link=new
\SQLite3($n);$Tg=$this->link->version();$this->server_info=$Tg["versionString"];return'';}function
query($F,$Cg=false){$G=@$this->link->query($F);$this->error="";if(!$G){$this->errno=$this->link->lastErrorCode();$this->error=$this->link->lastErrorMsg();return
false;}elseif($G->numColumns())return
new
Result($G);$this->affected_rows=$this->link->changes();return
true;}function
quote($Q){return(is_utf8($Q)?"'".$this->link->escapeString($Q)."'":"x'".first(unpack('H*',$Q))."'");}}class
Result{var$num_rows;private$result,$offset=0;function
__construct($G){$this->result=$G;}function
fetch_assoc(){return$this->result->fetchArray(SQLITE3_ASSOC);}function
fetch_row(){return$this->result->fetchArray(SQLITE3_NUM);}function
fetch_field(){$d=$this->offset++;$U=$this->result->columnType($d);return(object)array("name"=>$this->result->columnName($d),"type"=>($U==SQLITE3_TEXT?15:0),"charsetnr"=>($U==SQLITE3_BLOB?63:0),);}function
__destruct(){$this->result->finalize();}}}elseif(extension_loaded("pdo_sqlite")){abstract
class
SqliteDb
extends
PdoDb{var$extension="PDO_SQLite";function
attach($n,$V,$D){$this->dsn(DRIVER.":$n","","");$this->query("PRAGMA foreign_keys = 1");$this->query("PRAGMA busy_timeout = 500");return'';}}}if(class_exists('Adminer\SqliteDb')){class
Db
extends
SqliteDb{function
attach($n,$V,$D){parent::attach($n,$V,$D);$this->query("PRAGMA foreign_keys = 1");$this->query("PRAGMA busy_timeout = 500");return'';}function
select_db($n){if(is_readable($n)&&$this->query("ATTACH ".$this->quote(preg_match("~(^[/\\\\]|:)~",$n)?$n:dirname($_SERVER["SCRIPT_FILENAME"])."/$n")." AS a"))return!self::attach($n,'','');return
false;}}}class
Driver
extends
SqlDriver{static$cc=array("SQLite3","PDO_SQLite");static$td="sqlite";protected$types=array(array("integer"=>0,"real"=>0,"numeric"=>0,"text"=>0,"blob"=>0));var$insertFunctions=array();var$editFunctions=array("integer|real|numeric"=>"+/-","text"=>"||",);var$operators=array("=","<",">","<=",">=","!=","LIKE","LIKE %%","IN","IS NULL","NOT LIKE","NOT IN","IS NOT NULL","SQL");var$functions=array("hex","length","lower","round","unixepoch","upper");var$grouping=array("avg","count","count distinct","group_concat","max","min","sum");static
function
connect($M,$V,$D){if($D!="")return
lang(22);return
parent::connect(":memory:","","");}function
__construct(Db$g){parent::__construct($g);if(min_version(3.31,0,$g))$this->generated=array("STORED","VIRTUAL");}function
structuredTypes(){return
array_keys($this->types[0]);}function
insertUpdate($R,array$J,array$E){$Rg=array();foreach($J
as$N)$Rg[]="(".implode(", ",$N).")";return
queries("REPLACE INTO ".table($R)." (".implode(", ",array_keys(reset($J))).") VALUES\n".implode(",\n",$Rg));}function
tableHelp($B,$sd=false){if($B=="sqlite_sequence")return"fileformat2.html#seqtab";if($B=="sqlite_master")return"fileformat2.html#$B";}function
checkConstraints($R){preg_match_all('~ CHECK *(\( *(((?>[^()]*[^() ])|(?1))*) *\))~',get_val("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ".q($R),0,$this->conn),$A);return
array_combine($A[2],$A[2]);}function
allFields(){$H=array();foreach(tables_list()as$R=>$U){foreach(fields($R)as$l)$H[$R][]=$l;}return$H;}}function
idf_escape($t){return'"'.str_replace('"','""',$t).'"';}function
table($t){return
idf_escape($t);}function
get_databases($rc){return
array();}function
limit($F,$Z,$y,$ke=0,$L=" "){return" $F$Z".($y?$L."LIMIT $y".($ke?" OFFSET $ke":""):"");}function
limit1($R,$F,$Z,$L="\n"){return(preg_match('~^INTO~',$F)||get_val("SELECT sqlite_compileoption_used('ENABLE_UPDATE_DELETE_LIMIT')")?limit($F,$Z,1,0,$L):" $F WHERE rowid = (SELECT rowid FROM ".table($R).$Z.$L."LIMIT 1)");}function
db_collation($i,$Ua){return
get_val("PRAGMA encoding");}function
logged_user(){return
get_current_user();}function
tables_list(){return
get_key_vals("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY (name = 'sqlite_sequence'), name");}function
count_tables($sb){return
array();}function
table_status($B=""){$H=array();foreach(get_rows("SELECT name AS Name, type AS Engine, 'rowid' AS Oid, '' AS Auto_increment FROM sqlite_master WHERE type IN ('table', 'view') ".($B!=""?"AND name = ".q($B):"ORDER BY name"))as$I){$I["Rows"]=get_val("SELECT COUNT(*) FROM ".idf_escape($I["Name"]));$H[$I["Name"]]=$I;}foreach(get_rows("SELECT * FROM sqlite_sequence".($B!=""?" WHERE name = ".q($B):""),null,"")as$I)$H[$I["name"]]["Auto_increment"]=$I["seq"];return$H;}function
is_view($S){return$S["Engine"]=="view";}function
fk_support($S){return!get_val("SELECT sqlite_compileoption_used('OMIT_FOREIGN_KEY')");}function
fields($R){$H=array();$E="";foreach(get_rows("PRAGMA table_".(min_version(3.31)?"x":"")."info(".table($R).")")as$I){$B=$I["name"];$U=strtolower($I["type"]);$j=$I["dflt_value"];$H[$B]=array("field"=>$B,"type"=>(preg_match('~int~i',$U)?"integer":(preg_match('~char|clob|text~i',$U)?"text":(preg_match('~blob~i',$U)?"blob":(preg_match('~real|floa|doub~i',$U)?"real":"numeric")))),"full_type"=>$U,"default"=>(preg_match("~^'(.*)'$~",$j,$_)?str_replace("''","'",$_[1]):($j=="NULL"?null:$j)),"null"=>!$I["notnull"],"privileges"=>array("select"=>1,"insert"=>1,"update"=>1,"where"=>1,"order"=>1),"primary"=>$I["pk"],);if($I["pk"]){if($E!="")$H[$E]["auto_increment"]=false;elseif(preg_match('~^integer$~i',$U))$H[$B]["auto_increment"]=true;$E=$B;}}$Of=get_val("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ".q($R));$t='(("[^"]*+")+|[a-z0-9_]+)';preg_match_all('~'.$t.'\s+text\s+COLLATE\s+(\'[^\']+\'|\S+)~i',$Of,$A,PREG_SET_ORDER);foreach($A
as$_){$B=str_replace('""','"',preg_replace('~^"|"$~','',$_[1]));if($H[$B])$H[$B]["collation"]=trim($_[3],"'");}preg_match_all('~'.$t.'\s.*GENERATED ALWAYS AS \((.+)\) (STORED|VIRTUAL)~i',$Of,$A,PREG_SET_ORDER);foreach($A
as$_){$B=str_replace('""','"',preg_replace('~^"|"$~','',$_[1]));$H[$B]["default"]=$_[3];$H[$B]["generated"]=strtoupper($_[4]);}return$H;}function
indexes($R,$h=null){$h=connection($h);$H=array();$Of=get_val("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ".q($R),0,$h);if(preg_match('~\bPRIMARY\s+KEY\s*\((([^)"]+|"[^"]*"|`[^`]*`)++)~i',$Of,$_)){$H[""]=array("type"=>"PRIMARY","columns"=>array(),"lengths"=>array(),"descs"=>array());preg_match_all('~((("[^"]*+")+|(?:`[^`]*+`)+)|(\S+))(\s+(ASC|DESC))?(,\s*|$)~i',$_[1],$A,PREG_SET_ORDER);foreach($A
as$_){$H[""]["columns"][]=idf_unescape($_[2]).$_[4];$H[""]["descs"][]=(preg_match('~DESC~i',$_[5])?'1':null);}}if(!$H){foreach(fields($R)as$B=>$l){if($l["primary"])$H[""]=array("type"=>"PRIMARY","columns"=>array($B),"lengths"=>array(),"descs"=>array(null));}}$Qf=get_key_vals("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ".q($R),$h);foreach(get_rows("PRAGMA index_list(".table($R).")",$h)as$I){$B=$I["name"];$u=array("type"=>($I["unique"]?"UNIQUE":"INDEX"));$u["lengths"]=array();$u["descs"]=array();foreach(get_rows("PRAGMA index_info(".idf_escape($B).")",$h)as$qf){$u["columns"][]=$qf["name"];$u["descs"][]=null;}if(preg_match('~^CREATE( UNIQUE)? INDEX '.preg_quote(idf_escape($B).' ON '.idf_escape($R),'~').' \((.*)\)$~i',$Qf[$B],$hf)){preg_match_all('/("[^"]*+")+( DESC)?/',$hf[2],$A);foreach($A[2]as$w=>$X){if($X)$u["descs"][$w]='1';}}if(!$H[""]||$u["type"]!="UNIQUE"||$u["columns"]!=$H[""]["columns"]||$u["descs"]!=$H[""]["descs"]||!preg_match("~^sqlite_~",$B))$H[$B]=$u;}return$H;}function
foreign_keys($R){$H=array();foreach(get_rows("PRAGMA foreign_key_list(".table($R).")")as$I){$o=&$H[$I["id"]];if(!$o)$o=$I;$o["source"][]=$I["from"];$o["target"][]=$I["to"];}return$H;}function
view($B){return
array("select"=>preg_replace('~^(?:[^`"[]+|`[^`]*`|"[^"]*")* AS\s+~iU','',get_val("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ".q($B))));}function
collations(){return(isset($_GET["create"])?get_vals("PRAGMA collation_list",1):array());}function
information_schema($i){return
false;}function
error(){return
h(connection()->error);}function
check_sqlite_name($B){$cc="db|sdb|sqlite";if(!preg_match("~^[^\\0]*\\.($cc)\$~",$B)){connection()->error=lang(23,str_replace("|",", ",$cc));return
false;}return
true;}function
create_database($i,$c){if(file_exists($i)){connection()->error=lang(24);return
false;}if(!check_sqlite_name($i))return
false;try{$z=new
Db();$z->attach($i,'','');}catch(\Exception$Xb){connection()->error=$Xb->getMessage();return
false;}$z->query('PRAGMA encoding = "UTF-8"');$z->query('CREATE TABLE adminer (i)');$z->query('DROP TABLE adminer');return
true;}function
drop_databases($sb){connection()->attach(":memory:",'','');foreach($sb
as$i){if(!@unlink($i)){connection()->error=lang(24);return
false;}}return
true;}function
rename_database($B,$c){if(!check_sqlite_name($B))return
false;connection()->attach(":memory:",'','');connection()->error=lang(24);return@rename(DB,$B);}function
auto_increment(){return" PRIMARY KEY AUTOINCREMENT";}function
alter_table($R,$B,$m,$tc,$Ya,$Pb,$c,$ta,$Ke){$Ng=($R==""||$tc);foreach($m
as$l){if($l[0]!=""||!$l[1]||$l[2]){$Ng=true;break;}}$b=array();$Ce=array();foreach($m
as$l){if($l[1]){$b[]=($Ng?$l[1]:"ADD ".implode($l[1]));if($l[0]!="")$Ce[$l[0]]=$l[1][0];}}if(!$Ng){foreach($b
as$X){if(!queries("ALTER TABLE ".table($R)." $X"))return
false;}if($R!=$B&&!queries("ALTER TABLE ".table($R)." RENAME TO ".table($B)))return
false;}elseif(!recreate_table($R,$B,$b,$Ce,$tc,$ta))return
false;if($ta){queries("BEGIN");queries("UPDATE sqlite_sequence SET seq = $ta WHERE name = ".q($B));if(!connection()->affected_rows)queries("INSERT INTO sqlite_sequence (name, seq) VALUES (".q($B).", $ta)");queries("COMMIT");}return
true;}function
recreate_table($R,$B,array$m,array$Ce,array$tc,$ta="",$v=array(),$Eb="",$ea=""){if($R!=""){if(!$m){foreach(fields($R)as$w=>$l){if($v)$l["auto_increment"]=0;$m[]=process_field($l,$l);$Ce[$w]=idf_escape($w);}}$Ue=false;foreach($m
as$l){if($l[6])$Ue=true;}$Fb=array();foreach($v
as$w=>$X){if($X[2]=="DROP"){$Fb[$X[1]]=true;unset($v[$w]);}}foreach(indexes($R)as$vd=>$u){$e=array();foreach($u["columns"]as$w=>$d){if(!$Ce[$d])continue
2;$e[]=$Ce[$d].($u["descs"][$w]?" DESC":"");}if(!$Fb[$vd]){if($u["type"]!="PRIMARY"||!$Ue)$v[]=array($u["type"],$vd,$e);}}foreach($v
as$w=>$X){if($X[0]=="PRIMARY"){unset($v[$w]);$tc[]="  PRIMARY KEY (".implode(", ",$X[2]).")";}}foreach(foreign_keys($R)as$vd=>$o){foreach($o["source"]as$w=>$d){if(!$Ce[$d])continue
2;$o["source"][$w]=idf_unescape($Ce[$d]);}if(!isset($tc[" $vd"]))$tc[]=" ".format_foreign_key($o);}queries("BEGIN");}$Ja=array();foreach($m
as$l){if(preg_match('~GENERATED~',$l[3]))unset($Ce[array_search($l[0],$Ce)]);$Ja[]="  ".implode($l);}$Ja=array_merge($Ja,array_filter($tc));foreach(driver()->checkConstraints($R)as$La){if($La!=$Eb)$Ja[]="  CHECK ($La)";}if($ea)$Ja[]="  CHECK ($ea)";$dg=($R==$B?"adminer_$B":$B);if(!queries("CREATE TABLE ".table($dg)." (\n".implode(",\n",$Ja)."\n)"))return
false;if($R!=""){if($Ce&&!queries("INSERT INTO ".table($dg)." (".implode(", ",$Ce).") SELECT ".implode(", ",array_map('Adminer\idf_escape',array_keys($Ce)))." FROM ".table($R)))return
false;$_g=array();foreach(triggers($R)as$yg=>$kg){$xg=trigger($yg,$R);$_g[]="CREATE TRIGGER ".idf_escape($yg)." ".implode(" ",$kg)." ON ".table($B)."\n$xg[Statement]";}$ta=$ta?"":get_val("SELECT seq FROM sqlite_sequence WHERE name = ".q($R));if(!queries("DROP TABLE ".table($R))||($R==$B&&!queries("ALTER TABLE ".table($dg)." RENAME TO ".table($B)))||!alter_indexes($B,$v))return
false;if($ta)queries("UPDATE sqlite_sequence SET seq = $ta WHERE name = ".q($B));foreach($_g
as$xg){if(!queries($xg))return
false;}queries("COMMIT");}return
true;}function
index_sql($R,$U,$B,$e){return"CREATE $U ".($U!="INDEX"?"INDEX ":"").idf_escape($B!=""?$B:uniqid($R."_"))." ON ".table($R)." $e";}function
alter_indexes($R,$b){foreach($b
as$E){if($E[0]=="PRIMARY")return
recreate_table($R,$R,array(),array(),array(),"",$b);}foreach(array_reverse($b)as$X){if(!queries($X[2]=="DROP"?"DROP INDEX ".idf_escape($X[1]):index_sql($R,$X[0],$X[1],"(".implode(", ",$X[2]).")")))return
false;}return
true;}function
truncate_tables($T){return
apply_queries("DELETE FROM",$T);}function
drop_views($Vg){return
apply_queries("DROP VIEW",$Vg);}function
drop_tables($T){return
apply_queries("DROP TABLE",$T);}function
move_tables($T,$Vg,$cg){return
false;}function
trigger($B,$R){if($B=="")return
array("Statement"=>"BEGIN\n\t;\nEND");$t='(?:[^`"\s]+|`[^`]*`|"[^"]*")+';$zg=trigger_options();preg_match("~^CREATE\\s+TRIGGER\\s*$t\\s*(".implode("|",$zg["Timing"]).")\\s+([a-z]+)(?:\\s+OF\\s+($t))?\\s+ON\\s*$t\\s*(?:FOR\\s+EACH\\s+ROW\\s)?(.*)~is",get_val("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ".q($B)),$_);$je=$_[3];return
array("Timing"=>strtoupper($_[1]),"Event"=>strtoupper($_[2]).($je?" OF":""),"Of"=>idf_unescape($je),"Trigger"=>$B,"Statement"=>$_[4],);}function
triggers($R){$H=array();$zg=trigger_options();foreach(get_rows("SELECT * FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ".q($R))as$I){preg_match('~^CREATE\s+TRIGGER\s*(?:[^`"\s]+|`[^`]*`|"[^"]*")+\s*('.implode("|",$zg["Timing"]).')\s*(.*?)\s+ON\b~i',$I["sql"],$_);$H[$I["name"]]=array($_[1],$_[2]);}return$H;}function
trigger_options(){return
array("Timing"=>array("BEFORE","AFTER","INSTEAD OF"),"Event"=>array("INSERT","UPDATE","UPDATE OF","DELETE"),"Type"=>array("FOR EACH ROW"),);}function
begin(){return
queries("BEGIN");}function
last_id($G){return
get_val("SELECT LAST_INSERT_ROWID()");}function
explain($g,$F){return$g->query("EXPLAIN QUERY PLAN $F");}function
found_rows($S,$Z){}function
types(){return
array();}function
create_sql($R,$ta,$Tf){$H=get_val("SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name = ".q($R));foreach(indexes($R)as$B=>$u){if($B=='')continue;$H
.=";\n\n".index_sql($R,$u['type'],$B,"(".implode(", ",array_map('Adminer\idf_escape',$u['columns'])).")");}return$H;}function
truncate_sql($R){return"DELETE FROM ".table($R);}function
use_sql($rb){}function
trigger_sql($R){return
implode(get_vals("SELECT sql || ';;\n' FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ".q($R)));}function
show_variables(){$H=array();foreach(get_rows("PRAGMA pragma_list")as$I){$B=$I["name"];if($B!="pragma_list"&&$B!="compile_options"){$H[$B]=array($B,'');foreach(get_rows("PRAGMA $B")as$I)$H[$B][1].=implode(", ",$I)."\n";}}return$H;}function
show_status(){$H=array();foreach(get_vals("PRAGMA compile_options")as$ue)$H[]=explode("=",$ue,2);return$H;}function
convert_field($l){}function
unconvert_field($l,$H){return$H;}function
support($gc){return
preg_match('~^(check|columns|database|drop_col|dump|indexes|descidx|move_col|sql|status|table|trigger|variables|view|view_trigger)$~',$gc);}}add_driver("pgsql","PostgreSQL");if(isset($_GET["pgsql"])){define('Adminer\DRIVER',"pgsql");if(extension_loaded("pgsql")&&$_GET["ext"]!="pdo"){class
Db
extends
SqlDb{var$extension="PgSQL";var$timeout=0;private$link,$string,$database=true;function
_error($Ub,$k){if(ini_bool("html_errors"))$k=html_entity_decode(strip_tags($k));$k=preg_replace('~^[^:]*: ~','',$k);$this->error=$k;}function
attach($M,$V,$D){$i=adminer()->database();set_error_handler(array($this,'_error'));$this->string="host='".str_replace(":","' port='",addcslashes($M,"'\\"))."' user='".addcslashes($V,"'\\")."' password='".addcslashes($D,"'\\")."'";$O=adminer()->connectSsl();if(isset($O["mode"]))$this->string
.=" sslmode='".$O["mode"]."'";$this->link=@pg_connect("$this->string dbname='".($i!=""?addcslashes($i,"'\\"):"postgres")."'",PGSQL_CONNECT_FORCE_NEW);if(!$this->link&&$i!=""){$this->database=false;$this->link=@pg_connect("$this->string dbname='postgres'",PGSQL_CONNECT_FORCE_NEW);}restore_error_handler();if($this->link)pg_set_client_encoding($this->link,"UTF8");return($this->link?'':$this->error);}function
quote($Q){return(function_exists('pg_escape_literal')?pg_escape_literal($this->link,$Q):"'".pg_escape_string($this->link,$Q)."'");}function
value($X,array$l){return($l["type"]=="bytea"&&$X!==null?pg_unescape_bytea($X):$X);}function
select_db($rb){if($rb==adminer()->database())return$this->database;$H=@pg_connect("$this->string dbname='".addcslashes($rb,"'\\")."'",PGSQL_CONNECT_FORCE_NEW);if($H)$this->link=$H;return$H;}function
close(){$this->link=@pg_connect("$this->string dbname='postgres'");}function
query($F,$Cg=false){$G=@pg_query($this->link,$F);$this->error="";if(!$G){$this->error=pg_last_error($this->link);$H=false;}elseif(!pg_num_fields($G)){$this->affected_rows=pg_affected_rows($G);$H=true;}else$H=new
Result($G);if($this->timeout){$this->timeout=0;$this->query("RESET statement_timeout");}return$H;}function
warnings(){return
h(pg_last_notice($this->link));}}class
Result{var$num_rows;private$result,$offset=0;function
__construct($G){$this->result=$G;$this->num_rows=pg_num_rows($G);}function
fetch_assoc(){return
pg_fetch_assoc($this->result);}function
fetch_row(){return
pg_fetch_row($this->result);}function
fetch_field(){$d=$this->offset++;$H=new
\stdClass;$H->orgtable=pg_field_table($this->result,$d);$H->name=pg_field_name($this->result,$d);$H->type=pg_field_type($this->result,$d);$H->charsetnr=($H->type=="bytea"?63:0);return$H;}function
__destruct(){pg_free_result($this->result);}}}elseif(extension_loaded("pdo_pgsql")){class
Db
extends
PdoDb{var$extension="PDO_PgSQL";var$timeout=0;function
attach($M,$V,$D){$i=adminer()->database();$Gb="pgsql:host='".str_replace(":","' port='",addcslashes($M,"'\\"))."' client_encoding=utf8 dbname='".($i!=""?addcslashes($i,"'\\"):"postgres")."'";$O=adminer()->connectSsl();if(isset($O["mode"]))$Gb
.=" sslmode='".$O["mode"]."'";return$this->dsn($Gb,$V,$D);}function
select_db($rb){return(adminer()->database()==$rb);}function
query($F,$Cg=false){$H=parent::query($F,$Cg);if($this->timeout){$this->timeout=0;parent::query("RESET statement_timeout");}return$H;}function
warnings(){}function
close(){}}}class
Driver
extends
SqlDriver{static$cc=array("PgSQL","PDO_PgSQL");static$td="pgsql";var$operators=array("=","<",">","<=",">=","!=","~","!~","LIKE","LIKE %%","ILIKE","ILIKE %%","IN","IS NULL","NOT LIKE","NOT IN","IS NOT NULL");var$functions=array("char_length","lower","round","to_hex","to_timestamp","upper");var$grouping=array("avg","count","count distinct","max","min","sum");static
function
connect($M,$V,$D){$g=parent::connect($M,$V,$D);if(is_string($g))return$g;$Tg=get_val("SELECT version()",0,$g);$g->flavor=(preg_match('~CockroachDB~',$Tg)?'cockroach':'');$g->server_info=preg_replace('~^\D*([\d.]+[-\w]*).*~','\1',$Tg);if(min_version(9,0,$g))$g->query("SET application_name = 'Adminer'");if($g->flavor=='cockroach')add_driver(DRIVER,"CockroachDB");return$g;}function
__construct(Db$g){parent::__construct($g);$this->types=array(lang(25)=>array("smallint"=>5,"integer"=>10,"bigint"=>19,"boolean"=>1,"numeric"=>0,"real"=>7,"double precision"=>16,"money"=>20),lang(26)=>array("date"=>13,"time"=>17,"timestamp"=>20,"timestamptz"=>21,"interval"=>0),lang(27)=>array("character"=>0,"character varying"=>0,"text"=>0,"tsquery"=>0,"tsvector"=>0,"uuid"=>0,"xml"=>0),lang(28)=>array("bit"=>0,"bit varying"=>0,"bytea"=>0),lang(29)=>array("cidr"=>43,"inet"=>43,"macaddr"=>17,"macaddr8"=>23,"txid_snapshot"=>0),lang(30)=>array("box"=>0,"circle"=>0,"line"=>0,"lseg"=>0,"path"=>0,"point"=>0,"polygon"=>0),);if(min_version(9.2,0,$g)){$this->types[lang(27)]["json"]=4294967295;if(min_version(9.4,0,$g))$this->types[lang(27)]["jsonb"]=4294967295;}$this->insertFunctions=array("char"=>"md5","date|time"=>"now",);$this->editFunctions=array(number_type()=>"+/-","date|time"=>"+ interval/- interval","char|text"=>"||",);if(min_version(12,0,$g))$this->generated=array("STORED");}function
enumLength(array$l){$Qb=$this->types[lang(31)][$l["type"]];return($Qb?type_values($Qb):"");}function
setUserTypes($Bg){$this->types[lang(31)]=array_flip($Bg);}function
insertReturning($R){$ta=array_filter(fields($R),function($l){return$l['auto_increment'];});return(count($ta)==1?" RETURNING ".idf_escape(key($ta)):"");}function
insertUpdate($R,array$J,array$E){foreach($J
as$N){$Kg=array();$Z=array();foreach($N
as$w=>$X){$Kg[]="$w = $X";if(isset($E[idf_unescape($w)]))$Z[]="$w = $X";}if(!(($Z&&queries("UPDATE ".table($R)." SET ".implode(", ",$Kg)." WHERE ".implode(" AND ",$Z))&&connection()->affected_rows)||queries("INSERT INTO ".table($R)." (".implode(", ",array_keys($N)).") VALUES (".implode(", ",$N).")")))return
false;}return
true;}function
slowQuery($F,$jg){$this->conn->query("SET statement_timeout = ".(1000*$jg));$this->conn->timeout=1000*$jg;return$F;}function
convertSearch($t,array$X,array$l){$fg="char|text";if(strpos($X["op"],"LIKE")===false)$fg
.="|date|time(stamp)?|boolean|uuid|inet|cidr|macaddr|".number_type();return(preg_match("~$fg~",$l["type"])?$t:"CAST($t AS text)");}function
quoteBinary($rf){return"'\\x".bin2hex($rf)."'";}function
warnings(){return$this->conn->warnings();}function
tableHelp($B,$sd=false){$Fd=array("information_schema"=>"infoschema","pg_catalog"=>($sd?"view":"catalog"),);$z=$Fd[$_GET["ns"]];if($z)return"$z-".str_replace("_","-",$B).".html";}function
supportsIndex(array$S){return$S["Engine"]!="view";}function
hasCStyleEscapes(){static$Ia;if($Ia===null)$Ia=(get_val("SHOW standard_conforming_strings",0,$this->conn)=="off");return$Ia;}}function
idf_escape($t){return'"'.str_replace('"','""',$t).'"';}function
table($t){return
idf_escape($t);}function
get_databases($rc){return
get_vals("SELECT datname FROM pg_database
WHERE datallowconn = TRUE AND has_database_privilege(datname, 'CONNECT')
ORDER BY datname");}function
limit($F,$Z,$y,$ke=0,$L=" "){return" $F$Z".($y?$L."LIMIT $y".($ke?" OFFSET $ke":""):"");}function
limit1($R,$F,$Z,$L="\n"){return(preg_match('~^INTO~',$F)?limit($F,$Z,1,0,$L):" $F".(is_view(table_status1($R))?$Z:$L."WHERE ctid = (SELECT ctid FROM ".table($R).$Z.$L."LIMIT 1)"));}function
db_collation($i,$Ua){return
get_val("SELECT datcollate FROM pg_database WHERE datname = ".q($i));}function
logged_user(){return
get_val("SELECT user");}function
tables_list(){$F="SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema()";if(support("materializedview"))$F
.="
UNION ALL
SELECT matviewname, 'MATERIALIZED VIEW'
FROM pg_matviews
WHERE schemaname = current_schema()";$F
.="
ORDER BY 1";return
get_key_vals($F);}function
count_tables($sb){$H=array();foreach($sb
as$i){if(connection()->select_db($i))$H[$i]=count(tables_list());}return$H;}function
table_status($B=""){static$Mc;if($Mc===null)$Mc=get_val("SELECT 'pg_table_size'::regproc");$H=array();foreach(get_rows("SELECT
	c.relname AS \"Name\",
	CASE c.relkind WHEN 'r' THEN 'table' WHEN 'm' THEN 'materialized view' ELSE 'view' END AS \"Engine\"".($Mc?",
	pg_table_size(c.oid) AS \"Data_length\",
	pg_indexes_size(c.oid) AS \"Index_length\"":"").",
	obj_description(c.oid, 'pg_class') AS \"Comment\",
	".(min_version(12)?"''":"CASE WHEN c.relhasoids THEN 'oid' ELSE '' END")." AS \"Oid\",
	c.reltuples as \"Rows\",
	n.nspname
FROM pg_class c
JOIN pg_namespace n ON(n.nspname = current_schema() AND n.oid = c.relnamespace)
WHERE relkind IN ('r', 'm', 'v', 'f', 'p')
".($B!=""?"AND relname = ".q($B):"ORDER BY relname"))as$I)$H[$I["Name"]]=$I;return$H;}function
is_view($S){return
in_array($S["Engine"],array("view","materialized view"));}function
fk_support($S){return
true;}function
fields($R){$H=array();$ka=array('timestamp without time zone'=>'timestamp','timestamp with time zone'=>'timestamptz',);foreach(get_rows("SELECT
	a.attname AS field,
	format_type(a.atttypid, a.atttypmod) AS full_type,
	pg_get_expr(d.adbin, d.adrelid) AS default,
	a.attnotnull::int,
	col_description(c.oid, a.attnum) AS comment".(min_version(10)?",
	a.attidentity".(min_version(12)?",
	a.attgenerated":""):"")."
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_attribute a ON c.oid = a.attrelid
LEFT JOIN pg_attrdef d ON c.oid = d.adrelid AND a.attnum = d.adnum
WHERE c.relname = ".q($R)."
AND n.nspname = current_schema()
AND NOT a.attisdropped
AND a.attnum > 0
ORDER BY a.attnum")as$I){preg_match('~([^([]+)(\((.*)\))?([a-z ]+)?((\[[0-9]*])*)$~',$I["full_type"],$_);list(,$U,$x,$I["length"],$fa,$na)=$_;$I["length"].=$na;$Ma=$U.$fa;if(isset($ka[$Ma])){$I["type"]=$ka[$Ma];$I["full_type"]=$I["type"].$x.$na;}else{$I["type"]=$U;$I["full_type"]=$I["type"].$x.$fa.$na;}if(in_array($I['attidentity'],array('a','d')))$I['default']='GENERATED '.($I['attidentity']=='d'?'BY DEFAULT':'ALWAYS').' AS IDENTITY';$I["generated"]=($I["attgenerated"]=="s"?"STORED":"");$I["null"]=!$I["attnotnull"];$I["auto_increment"]=$I['attidentity']||preg_match('~^nextval\(~i',$I["default"])||preg_match('~^unique_rowid\(~',$I["default"]);$I["privileges"]=array("insert"=>1,"select"=>1,"update"=>1,"where"=>1,"order"=>1);if(preg_match('~(.+)::[^,)]+(.*)~',$I["default"],$_))$I["default"]=($_[1]=="NULL"?null:idf_unescape($_[1]).$_[2]);$H[$I["field"]]=$I;}return$H;}function
indexes($R,$h=null){$h=connection($h);$H=array();$bg=get_val("SELECT oid FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()) AND relname = ".q($R),0,$h);$e=get_key_vals("SELECT attnum, attname FROM pg_attribute WHERE attrelid = $bg AND attnum > 0",$h);foreach(get_rows("SELECT relname, indisunique::int, indisprimary::int, indkey, indoption, (indpred IS NOT NULL)::int as indispartial
FROM pg_index i, pg_class ci
WHERE i.indrelid = $bg AND ci.oid = i.indexrelid
ORDER BY indisprimary DESC, indisunique DESC",$h)as$I){$if=$I["relname"];$H[$if]["type"]=($I["indispartial"]?"INDEX":($I["indisprimary"]?"PRIMARY":($I["indisunique"]?"UNIQUE":"INDEX")));$H[$if]["columns"]=array();$H[$if]["descs"]=array();if($I["indkey"]){foreach(explode(" ",$I["indkey"])as$ed)$H[$if]["columns"][]=$e[$ed];foreach(explode(" ",$I["indoption"])as$fd)$H[$if]["descs"][]=(intval($fd)&1?'1':null);}$H[$if]["lengths"]=array();}return$H;}function
foreign_keys($R){$H=array();foreach(get_rows("SELECT conname, condeferrable::int AS deferrable, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = (SELECT pc.oid FROM pg_class AS pc INNER JOIN pg_namespace AS pn ON (pn.oid = pc.relnamespace) WHERE pc.relname = ".q($R)." AND pn.nspname = current_schema())
AND contype = 'f'::char
ORDER BY conkey, conname")as$I){if(preg_match('~FOREIGN KEY\s*\((.+)\)\s*REFERENCES (.+)\((.+)\)(.*)$~iA',$I['definition'],$_)){$I['source']=array_map('Adminer\idf_unescape',array_map('trim',explode(',',$_[1])));if(preg_match('~^(("([^"]|"")+"|[^"]+)\.)?"?("([^"]|"")+"|[^"]+)$~',$_[2],$Ld)){$I['ns']=idf_unescape($Ld[2]);$I['table']=idf_unescape($Ld[4]);}$I['target']=array_map('Adminer\idf_unescape',array_map('trim',explode(',',$_[3])));$I['on_delete']=(preg_match("~ON DELETE (driver()->onActions)~",$_[4],$Ld)?$Ld[1]:'NO ACTION');$I['on_update']=(preg_match("~ON UPDATE (driver()->onActions)~",$_[4],$Ld)?$Ld[1]:'NO ACTION');$H[$I['conname']]=$I;}}return$H;}function
view($B){return
array("select"=>trim(get_val("SELECT pg_get_viewdef(".get_val("SELECT oid FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()) AND relname = ".q($B)).")")));}function
collations(){return
array();}function
information_schema($i){return
get_schema()=="information_schema";}function
error(){$H=h(connection()->error);if(preg_match('~^(.*\n)?([^\n]*)\n( *)\^(\n.*)?$~s',$H,$_))$H=$_[1].preg_replace('~((?:[^&]|&[^;]*;){'.strlen($_[3]).'})(.*)~','\1<b>\2</b>',$_[2]).$_[4];return
nl_br($H);}function
create_database($i,$c){return
queries("CREATE DATABASE ".idf_escape($i).($c?" ENCODING ".idf_escape($c):""));}function
drop_databases($sb){connection()->close();return
apply_queries("DROP DATABASE",$sb,'Adminer\idf_escape');}function
rename_database($B,$c){connection()->close();return
queries("ALTER DATABASE ".idf_escape(DB)." RENAME TO ".idf_escape($B));}function
auto_increment(){return"";}function
alter_table($R,$B,$m,$tc,$Ya,$Pb,$c,$ta,$Ke){$b=array();$af=array();if($R!=""&&$R!=$B)$af[]="ALTER TABLE ".table($R)." RENAME TO ".table($B);$Af="";foreach($m
as$l){$d=idf_escape($l[0]);$X=$l[1];if(!$X)$b[]="DROP $d";else{$Qg=$X[5];unset($X[5]);if($l[0]==""){if(isset($X[6]))$X[1]=($X[1]==" bigint"?" big":($X[1]==" smallint"?" small":" "))."serial";$b[]=($R!=""?"ADD ":"  ").implode($X);if(isset($X[6]))$b[]=($R!=""?"ADD":" ")." PRIMARY KEY ($X[0])";}else{if($d!=$X[0])$af[]="ALTER TABLE ".table($B)." RENAME $d TO $X[0]";$b[]="ALTER $d TYPE$X[1]";$Bf=$R."_".idf_unescape($X[0])."_seq";$b[]="ALTER $d ".($X[3]?"SET".preg_replace('~GENERATED ALWAYS(.*) STORED~','EXPRESSION\1',$X[3]):(isset($X[6])?"SET DEFAULT nextval(".q($Bf).")":"DROP DEFAULT"));if(isset($X[6]))$Af="CREATE SEQUENCE IF NOT EXISTS ".idf_escape($Bf)." OWNED BY ".idf_escape($R).".$X[0]";$b[]="ALTER $d ".($X[2]==" NULL"?"DROP NOT":"SET").$X[2];}if($l[0]!=""||$Qg!="")$af[]="COMMENT ON COLUMN ".table($B).".$X[0] IS ".($Qg!=""?substr($Qg,9):"''");}}$b=array_merge($b,$tc);if($R=="")array_unshift($af,"CREATE TABLE ".table($B)." (\n".implode(",\n",$b)."\n)");elseif($b)array_unshift($af,"ALTER TABLE ".table($R)."\n".implode(",\n",$b));if($Af)array_unshift($af,$Af);if($Ya!==null)$af[]="COMMENT ON TABLE ".table($B)." IS ".q($Ya);foreach($af
as$F){if(!queries($F))return
false;}return
true;}function
alter_indexes($R,$b){$jb=array();$Db=array();$af=array();foreach($b
as$X){if($X[0]!="INDEX")$jb[]=($X[2]=="DROP"?"\nDROP CONSTRAINT ".idf_escape($X[1]):"\nADD".($X[1]!=""?" CONSTRAINT ".idf_escape($X[1]):"")." $X[0] ".($X[0]=="PRIMARY"?"KEY ":"")."(".implode(", ",$X[2]).")");elseif($X[2]=="DROP")$Db[]=idf_escape($X[1]);else$af[]="CREATE INDEX ".idf_escape($X[1]!=""?$X[1]:uniqid($R."_"))." ON ".table($R)." (".implode(", ",$X[2]).")";}if($jb)array_unshift($af,"ALTER TABLE ".table($R).implode(",",$jb));if($Db)array_unshift($af,"DROP INDEX ".implode(", ",$Db));foreach($af
as$F){if(!queries($F))return
false;}return
true;}function
truncate_tables($T){return
queries("TRUNCATE ".implode(", ",array_map('Adminer\table',$T)));}function
drop_views($Vg){return
drop_tables($Vg);}function
drop_tables($T){foreach($T
as$R){$P=table_status1($R);if(!queries("DROP ".strtoupper($P["Engine"])." ".table($R)))return
false;}return
true;}function
move_tables($T,$Vg,$cg){foreach(array_merge($T,$Vg)as$R){$P=table_status1($R);if(!queries("ALTER ".strtoupper($P["Engine"])." ".table($R)." SET SCHEMA ".idf_escape($cg)))return
false;}return
true;}function
trigger($B,$R){if($B=="")return
array("Statement"=>"EXECUTE PROCEDURE ()");$e=array();$Z="WHERE trigger_schema = current_schema() AND event_object_table = ".q($R)." AND trigger_name = ".q($B);foreach(get_rows("SELECT * FROM information_schema.triggered_update_columns $Z")as$I)$e[]=$I["event_object_column"];$H=array();foreach(get_rows('SELECT trigger_name AS "Trigger", action_timing AS "Timing", event_manipulation AS "Event", \'FOR EACH \' || action_orientation AS "Type", action_statement AS "Statement"
FROM information_schema.triggers'."
$Z
ORDER BY event_manipulation DESC")as$I){if($e&&$I["Event"]=="UPDATE")$I["Event"].=" OF";$I["Of"]=implode(", ",$e);if($H)$I["Event"].=" OR $H[Event]";$H=$I;}return$H;}function
triggers($R){$H=array();foreach(get_rows("SELECT * FROM information_schema.triggers WHERE trigger_schema = current_schema() AND event_object_table = ".q($R))as$I){$xg=trigger($I["trigger_name"],$R);$H[$xg["Trigger"]]=array($xg["Timing"],$xg["Event"]);}return$H;}function
trigger_options(){return
array("Timing"=>array("BEFORE","AFTER"),"Event"=>array("INSERT","UPDATE","UPDATE OF","DELETE","INSERT OR UPDATE","INSERT OR UPDATE OF","DELETE OR INSERT","DELETE OR UPDATE","DELETE OR UPDATE OF","DELETE OR INSERT OR UPDATE","DELETE OR INSERT OR UPDATE OF"),"Type"=>array("FOR EACH ROW","FOR EACH STATEMENT"),);}function
routine($B,$U){$J=get_rows('SELECT routine_definition AS definition, LOWER(external_language) AS language, *
FROM information_schema.routines
WHERE routine_schema = current_schema() AND specific_name = '.q($B));$H=idx($J,0,array());$H["returns"]=array("type"=>$H["type_udt_name"]);$H["fields"]=get_rows('SELECT parameter_name AS field, data_type AS type, character_maximum_length AS length, parameter_mode AS inout
FROM information_schema.parameters
WHERE specific_schema = current_schema() AND specific_name = '.q($B).'
ORDER BY ordinal_position');return$H;}function
routines(){return
get_rows('SELECT specific_name AS "SPECIFIC_NAME", routine_type AS "ROUTINE_TYPE", routine_name AS "ROUTINE_NAME", type_udt_name AS "DTD_IDENTIFIER"
FROM information_schema.routines
WHERE routine_schema = current_schema()
ORDER BY SPECIFIC_NAME');}function
routine_languages(){return
get_vals("SELECT LOWER(lanname) FROM pg_catalog.pg_language");}function
routine_id($B,$I){$H=array();foreach($I["fields"]as$l){$x=$l["length"];$H[]=$l["type"].($x?"($x)":"");}return
idf_escape($B)."(".implode(", ",$H).")";}function
last_id($G){$I=(is_object($G)?$G->fetch_row():array());return($I?$I[0]:0);}function
explain($g,$F){return$g->query("EXPLAIN $F");}function
found_rows($S,$Z){if(preg_match("~ rows=([0-9]+)~",get_val("EXPLAIN SELECT * FROM ".idf_escape($S["Name"]).($Z?" WHERE ".implode(" AND ",$Z):"")),$hf))return$hf[1];}function
types(){return
get_key_vals("SELECT oid, typname
FROM pg_type
WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
AND typtype IN ('b','d','e')
AND typelem = 0");}function
type_values($s){$Sb=get_vals("SELECT enumlabel FROM pg_enum WHERE enumtypid = $s ORDER BY enumsortorder");return($Sb?"'".implode("', '",array_map('addslashes',$Sb))."'":"");}function
schemas(){return
get_vals("SELECT nspname FROM pg_namespace ORDER BY nspname");}function
get_schema(){return
get_val("SELECT current_schema()");}function
set_schema($sf,$h=null){if(!$h)$h=connection();$H=$h->query("SET search_path TO ".idf_escape($sf));driver()->setUserTypes(types());return$H;}function
foreign_keys_sql($R){$H="";$P=table_status1($R);$pc=foreign_keys($R);ksort($pc);foreach($pc
as$oc=>$nc)$H
.="ALTER TABLE ONLY ".idf_escape($P['nspname']).".".idf_escape($P['Name'])." ADD CONSTRAINT ".idf_escape($oc)." $nc[definition] ".($nc['deferrable']?'DEFERRABLE':'NOT DEFERRABLE').";\n";return($H?"$H\n":$H);}function
create_sql($R,$ta,$Tf){$of=array();$Cf=array();$P=table_status1($R);if(is_view($P)){$Ug=view($R);return
rtrim("CREATE VIEW ".idf_escape($R)." AS $Ug[select]",";");}$m=fields($R);if(count($P)<2||empty($m))return
false;$H="CREATE TABLE ".idf_escape($P['nspname']).".".idf_escape($P['Name'])." (\n    ";foreach($m
as$l){$Je=idf_escape($l['field']).' '.$l['full_type'].default_value($l).($l['null']?"":" NOT NULL");$of[]=$Je;if(preg_match('~nextval\(\'([^\']+)\'\)~',$l['default'],$A)){$Bf=$A[1];$Nf=first(get_rows((min_version(10)?"SELECT *, cache_size AS cache_value FROM pg_sequences WHERE schemaname = current_schema() AND sequencename = ".q(idf_unescape($Bf)):"SELECT * FROM $Bf"),null,"-- "));$Cf[]=($Tf=="DROP+CREATE"?"DROP SEQUENCE IF EXISTS $Bf;\n":"")."CREATE SEQUENCE $Bf INCREMENT $Nf[increment_by] MINVALUE $Nf[min_value] MAXVALUE $Nf[max_value]".($ta&&$Nf['last_value']?" START ".($Nf["last_value"]+1):"")." CACHE $Nf[cache_value];";}}if(!empty($Cf))$H=implode("\n\n",$Cf)."\n\n$H";$E="";foreach(indexes($R)as$cd=>$u){if($u['type']=='PRIMARY'){$E=$cd;$of[]="CONSTRAINT ".idf_escape($cd)." PRIMARY KEY (".implode(', ',array_map('Adminer\idf_escape',$u['columns'])).")";}}foreach(driver()->checkConstraints($R)as$cb=>$eb)$of[]="CONSTRAINT ".idf_escape($cb)." CHECK $eb";$H
.=implode(",\n    ",$of)."\n) WITH (oids = ".($P['Oid']?'true':'false').");";if($P['Comment'])$H
.="\n\nCOMMENT ON TABLE ".idf_escape($P['nspname']).".".idf_escape($P['Name'])." IS ".q($P['Comment']).";";foreach($m
as$hc=>$l){if($l['comment'])$H
.="\n\nCOMMENT ON COLUMN ".idf_escape($P['nspname']).".".idf_escape($P['Name']).".".idf_escape($hc)." IS ".q($l['comment']).";";}foreach(get_rows("SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname = current_schema() AND tablename = ".q($R).($E?" AND indexname != ".q($E):""),null,"-- ")as$I)$H
.="\n\n$I[indexdef];";return
rtrim($H,';');}function
truncate_sql($R){return"TRUNCATE ".table($R);}function
trigger_sql($R){$P=table_status1($R);$H="";foreach(triggers($R)as$wg=>$vg){$xg=trigger($wg,$P['Name']);$H
.="\nCREATE TRIGGER ".idf_escape($xg['Trigger'])." $xg[Timing] $xg[Event] ON ".idf_escape($P["nspname"]).".".idf_escape($P['Name'])." $xg[Type] $xg[Statement];;\n";}return$H;}function
use_sql($rb){return"\connect ".idf_escape($rb);}function
show_variables(){return
get_rows("SHOW ALL");}function
process_list(){return
get_rows("SELECT * FROM pg_stat_activity ORDER BY ".(min_version(9.2)?"pid":"procpid"));}function
convert_field($l){}function
unconvert_field($l,$H){return$H;}function
support($gc){return
preg_match('~^(check|database|table|columns|sql|indexes|descidx|comment|view|'.(min_version(9.3)?'materializedview|':'').'scheme|'.(min_version(11)?'procedure|':'').'routine|sequence|trigger|type|variables|drop_col'.(connection()->flavor=='cockroach'?'':'|processlist').'|kill|dump)$~',$gc);}function
kill_process($X){return
queries("SELECT pg_terminate_backend(".number($X).")");}function
connection_id(){return"SELECT pg_backend_pid()";}function
max_connections(){return
get_val("SHOW max_connections");}}add_driver("oracle","Oracle (beta)");if(isset($_GET["oracle"])){define('Adminer\DRIVER',"oracle");if(extension_loaded("oci8")&&$_GET["ext"]!="pdo"){class
Db
extends
SqlDb{var$extension="oci8";var$_current_db;private$link;function
_error($Ub,$k){if(ini_bool("html_errors"))$k=html_entity_decode(strip_tags($k));$k=preg_replace('~^[^:]*: ~','',$k);$this->error=$k;}function
attach($M,$V,$D){$this->link=@oci_new_connect($V,$D,$M,"AL32UTF8");if($this->link){$this->server_info=oci_server_version($this->link);return'';}$k=oci_error();return$k["message"];}function
quote($Q){return"'".str_replace("'","''",$Q)."'";}function
select_db($rb){$this->_current_db=$rb;return
true;}function
query($F,$Cg=false){$G=oci_parse($this->link,$F);$this->error="";if(!$G){$k=oci_error($this->link);$this->errno=$k["code"];$this->error=$k["message"];return
false;}set_error_handler(array($this,'_error'));$H=@oci_execute($G);restore_error_handler();if($H){if(oci_num_fields($G))return
new
Result($G);$this->affected_rows=oci_num_rows($G);oci_free_statement($G);}return$H;}}class
Result{var$num_rows;private$result,$offset=1;function
__construct($G){$this->result=$G;}private
function
convert($I){foreach((array)$I
as$w=>$X){if(is_a($X,'OCILob')||is_a($X,'OCI-Lob'))$I[$w]=$X->load();}return$I;}function
fetch_assoc(){return$this->convert(oci_fetch_assoc($this->result));}function
fetch_row(){return$this->convert(oci_fetch_row($this->result));}function
fetch_field(){$d=$this->offset++;$H=new
\stdClass;$H->name=oci_field_name($this->result,$d);$H->type=oci_field_type($this->result,$d);$H->charsetnr=(preg_match("~raw|blob|bfile~",$H->type)?63:0);return$H;}function
__destruct(){oci_free_statement($this->result);}}}elseif(extension_loaded("pdo_oci")){class
Db
extends
PdoDb{var$extension="PDO_OCI";var$_current_db;function
attach($M,$V,$D){return$this->dsn("oci:dbname=//$M;charset=AL32UTF8",$V,$D);}function
select_db($rb){$this->_current_db=$rb;return
true;}}}class
Driver
extends
SqlDriver{static$cc=array("OCI8","PDO_OCI");static$td="oracle";var$insertFunctions=array("date"=>"current_date","timestamp"=>"current_timestamp",);var$editFunctions=array("number|float|double"=>"+/-","date|timestamp"=>"+ interval/- interval","char|clob"=>"||",);var$operators=array("=","<",">","<=",">=","!=","LIKE","LIKE %%","IN","IS NULL","NOT LIKE","NOT IN","IS NOT NULL","SQL");var$functions=array("length","lower","round","upper");var$grouping=array("avg","count","count distinct","max","min","sum");function
__construct(Db$g){parent::__construct($g);$this->types=array(lang(25)=>array("number"=>38,"binary_float"=>12,"binary_double"=>21),lang(26)=>array("date"=>10,"timestamp"=>29,"interval year"=>12,"interval day"=>28),lang(27)=>array("char"=>2000,"varchar2"=>4000,"nchar"=>2000,"nvarchar2"=>4000,"clob"=>4294967295,"nclob"=>4294967295),lang(28)=>array("raw"=>2000,"long raw"=>2147483648,"blob"=>4294967295,"bfile"=>4294967296),);}function
begin(){return
true;}function
insertUpdate($R,array$J,array$E){foreach($J
as$N){$Kg=array();$Z=array();foreach($N
as$w=>$X){$Kg[]="$w = $X";if(isset($E[idf_unescape($w)]))$Z[]="$w = $X";}if(!(($Z&&queries("UPDATE ".table($R)." SET ".implode(", ",$Kg)." WHERE ".implode(" AND ",$Z))&&connection()->affected_rows)||queries("INSERT INTO ".table($R)." (".implode(", ",array_keys($N)).") VALUES (".implode(", ",$N).")")))return
false;}return
true;}function
hasCStyleEscapes(){return
true;}}function
idf_escape($t){return'"'.str_replace('"','""',$t).'"';}function
table($t){return
idf_escape($t);}function
get_databases($rc){return
get_vals("SELECT DISTINCT tablespace_name FROM (
SELECT tablespace_name FROM user_tablespaces
UNION SELECT tablespace_name FROM all_tables WHERE tablespace_name IS NOT NULL
)
ORDER BY 1");}function
limit($F,$Z,$y,$ke=0,$L=" "){return($ke?" * FROM (SELECT t.*, rownum AS rnum FROM (SELECT $F$Z) t WHERE rownum <= ".($y+$ke).") WHERE rnum > $ke":($y?" * FROM (SELECT $F$Z) WHERE rownum <= ".($y+$ke):" $F$Z"));}function
limit1($R,$F,$Z,$L="\n"){return" $F$Z";}function
db_collation($i,$Ua){return
get_val("SELECT value FROM nls_database_parameters WHERE parameter = 'NLS_CHARACTERSET'");}function
logged_user(){return
get_val("SELECT USER FROM DUAL");}function
get_current_db(){$i=connection()->_current_db?:DB;unset(connection()->_current_db);return$i;}function
where_owner($Te,$Ee="owner"){if(!$_GET["ns"])return'';return"$Te$Ee = sys_context('USERENV', 'CURRENT_SCHEMA')";}function
views_table($e){$Ee=where_owner('');return"(SELECT $e FROM all_views WHERE ".($Ee?:"rownum < 0").")";}function
tables_list(){$Ug=views_table("view_name");$Ee=where_owner(" AND ");return
get_key_vals("SELECT table_name, 'table' FROM all_tables WHERE tablespace_name = ".q(DB)."$Ee
UNION SELECT view_name, 'view' FROM $Ug
ORDER BY 1");}function
count_tables($sb){$H=array();foreach($sb
as$i)$H[$i]=get_val("SELECT COUNT(*) FROM all_tables WHERE tablespace_name = ".q($i));return$H;}function
table_status($B=""){$H=array();$uf=q($B);$i=get_current_db();$Ug=views_table("view_name");$Ee=where_owner(" AND ");foreach(get_rows('SELECT table_name "Name", \'table\' "Engine", avg_row_len * num_rows "Data_length", num_rows "Rows" FROM all_tables WHERE tablespace_name = '.q($i).$Ee.($B!=""?" AND table_name = $uf":"")."
UNION SELECT view_name, 'view', 0, 0 FROM $Ug".($B!=""?" WHERE view_name = $uf":"")."
ORDER BY 1")as$I)$H[$I["Name"]]=$I;return$H;}function
is_view($S){return$S["Engine"]=="view";}function
fk_support($S){return
true;}function
fields($R){$H=array();$Ee=where_owner(" AND ");foreach(get_rows("SELECT * FROM all_tab_columns WHERE table_name = ".q($R)."$Ee ORDER BY column_id")as$I){$U=$I["DATA_TYPE"];$x="$I[DATA_PRECISION],$I[DATA_SCALE]";if($x==",")$x=$I["CHAR_COL_DECL_LENGTH"];$H[$I["COLUMN_NAME"]]=array("field"=>$I["COLUMN_NAME"],"full_type"=>$U.($x?"($x)":""),"type"=>strtolower($U),"length"=>$x,"default"=>$I["DATA_DEFAULT"],"null"=>($I["NULLABLE"]=="Y"),"privileges"=>array("insert"=>1,"select"=>1,"update"=>1,"where"=>1,"order"=>1),);}return$H;}function
indexes($R,$h=null){$H=array();$Ee=where_owner(" AND ","aic.table_owner");foreach(get_rows("SELECT aic.*, ac.constraint_type, atc.data_default
FROM all_ind_columns aic
LEFT JOIN all_constraints ac ON aic.index_name = ac.constraint_name AND aic.table_name = ac.table_name AND aic.index_owner = ac.owner
LEFT JOIN all_tab_cols atc ON aic.column_name = atc.column_name AND aic.table_name = atc.table_name AND aic.index_owner = atc.owner
WHERE aic.table_name = ".q($R)."$Ee
ORDER BY ac.constraint_type, aic.column_position",$h)as$I){$cd=$I["INDEX_NAME"];$Wa=$I["DATA_DEFAULT"];$Wa=($Wa?trim($Wa,'"'):$I["COLUMN_NAME"]);$H[$cd]["type"]=($I["CONSTRAINT_TYPE"]=="P"?"PRIMARY":($I["CONSTRAINT_TYPE"]=="U"?"UNIQUE":"INDEX"));$H[$cd]["columns"][]=$Wa;$H[$cd]["lengths"][]=($I["CHAR_LENGTH"]&&$I["CHAR_LENGTH"]!=$I["COLUMN_LENGTH"]?$I["CHAR_LENGTH"]:null);$H[$cd]["descs"][]=($I["DESCEND"]&&$I["DESCEND"]=="DESC"?'1':null);}return$H;}function
view($B){$Ug=views_table("view_name, text");$J=get_rows('SELECT text "select" FROM '.$Ug.' WHERE view_name = '.q($B));return
reset($J);}function
collations(){return
array();}function
information_schema($i){return
get_schema()=="INFORMATION_SCHEMA";}function
error(){return
h(connection()->error);}function
explain($g,$F){$g->query("EXPLAIN PLAN FOR $F");return$g->query("SELECT * FROM plan_table");}function
found_rows($S,$Z){}function
auto_increment(){return"";}function
alter_table($R,$B,$m,$tc,$Ya,$Pb,$c,$ta,$Ke){$b=$Db=array();$Ae=($R?fields($R):array());foreach($m
as$l){$X=$l[1];if($X&&$l[0]!=""&&idf_escape($l[0])!=$X[0])queries("ALTER TABLE ".table($R)." RENAME COLUMN ".idf_escape($l[0])." TO $X[0]");$_e=$Ae[$l[0]];if($X&&$_e){$me=process_field($_e,$_e);if($X[2]==$me[2])$X[2]="";}if($X)$b[]=($R!=""?($l[0]!=""?"MODIFY (":"ADD ("):"  ").implode($X).($R!=""?")":"");else$Db[]=idf_escape($l[0]);}if($R=="")return
queries("CREATE TABLE ".table($B)." (\n".implode(",\n",$b)."\n)");return(!$b||queries("ALTER TABLE ".table($R)."\n".implode("\n",$b)))&&(!$Db||queries("ALTER TABLE ".table($R)." DROP (".implode(", ",$Db).")"))&&($R==$B||queries("ALTER TABLE ".table($R)." RENAME TO ".table($B)));}function
alter_indexes($R,$b){$Db=array();$af=array();foreach($b
as$X){if($X[0]!="INDEX"){$X[2]=preg_replace('~ DESC$~','',$X[2]);$jb=($X[2]=="DROP"?"\nDROP CONSTRAINT ".idf_escape($X[1]):"\nADD".($X[1]!=""?" CONSTRAINT ".idf_escape($X[1]):"")." $X[0] ".($X[0]=="PRIMARY"?"KEY ":"")."(".implode(", ",$X[2]).")");array_unshift($af,"ALTER TABLE ".table($R).$jb);}elseif($X[2]=="DROP")$Db[]=idf_escape($X[1]);else$af[]="CREATE INDEX ".idf_escape($X[1]!=""?$X[1]:uniqid($R."_"))." ON ".table($R)." (".implode(", ",$X[2]).")";}if($Db)array_unshift($af,"DROP INDEX ".implode(", ",$Db));foreach($af
as$F){if(!queries($F))return
false;}return
true;}function
foreign_keys($R){$H=array();$F="SELECT c_list.CONSTRAINT_NAME as NAME,
c_src.COLUMN_NAME as SRC_COLUMN,
c_dest.OWNER as DEST_DB,
c_dest.TABLE_NAME as DEST_TABLE,
c_dest.COLUMN_NAME as DEST_COLUMN,
c_list.DELETE_RULE as ON_DELETE
FROM ALL_CONSTRAINTS c_list, ALL_CONS_COLUMNS c_src, ALL_CONS_COLUMNS c_dest
WHERE c_list.CONSTRAINT_NAME = c_src.CONSTRAINT_NAME
AND c_list.R_CONSTRAINT_NAME = c_dest.CONSTRAINT_NAME
AND c_list.CONSTRAINT_TYPE = 'R'
AND c_src.TABLE_NAME = ".q($R);foreach(get_rows($F)as$I)$H[$I['NAME']]=array("db"=>$I['DEST_DB'],"table"=>$I['DEST_TABLE'],"source"=>array($I['SRC_COLUMN']),"target"=>array($I['DEST_COLUMN']),"on_delete"=>$I['ON_DELETE'],"on_update"=>null,);return$H;}function
truncate_tables($T){return
apply_queries("TRUNCATE TABLE",$T);}function
drop_views($Vg){return
apply_queries("DROP VIEW",$Vg);}function
drop_tables($T){return
apply_queries("DROP TABLE",$T);}function
last_id($G){return
0;}function
schemas(){$H=get_vals("SELECT DISTINCT owner FROM dba_segments WHERE owner IN (SELECT username FROM dba_users WHERE default_tablespace NOT IN ('SYSTEM','SYSAUX')) ORDER BY 1");return($H?:get_vals("SELECT DISTINCT owner FROM all_tables WHERE tablespace_name = ".q(DB)." ORDER BY 1"));}function
get_schema(){return
get_val("SELECT sys_context('USERENV', 'SESSION_USER') FROM dual");}function
set_schema($tf,$h=null){if(!$h)$h=connection();return$h->query("ALTER SESSION SET CURRENT_SCHEMA = ".idf_escape($tf));}function
show_variables(){return
get_rows('SELECT name, display_value FROM v$parameter');}function
show_status(){$H=array();$J=get_rows('SELECT * FROM v$instance');foreach(reset($J)as$w=>$X)$H[]=array($w,$X);return$H;}function
process_list(){return
get_rows('SELECT
	sess.process AS "process",
	sess.username AS "user",
	sess.schemaname AS "schema",
	sess.status AS "status",
	sess.wait_class AS "wait_class",
	sess.seconds_in_wait AS "seconds_in_wait",
	sql.sql_text AS "sql_text",
	sess.machine AS "machine",
	sess.port AS "port"
FROM v$session sess LEFT OUTER JOIN v$sql sql
ON sql.sql_id = sess.sql_id
WHERE sess.type = \'USER\'
ORDER BY PROCESS
');}function
convert_field($l){}function
unconvert_field($l,$H){return$H;}function
support($gc){return
preg_match('~^(columns|database|drop_col|indexes|descidx|processlist|scheme|sql|status|table|variables|view)$~',$gc);}}add_driver("mssql","MS SQL");if(isset($_GET["mssql"])){define('Adminer\DRIVER',"mssql");if(extension_loaded("sqlsrv")&&$_GET["ext"]!="pdo"){class
Db
extends
SqlDb{var$extension="sqlsrv";private$link,$result;private
function
get_error(){$this->error="";foreach(sqlsrv_errors()as$k){$this->errno=$k["code"];$this->error
.="$k[message]\n";}$this->error=rtrim($this->error);}function
attach($M,$V,$D){$db=array("UID"=>$V,"PWD"=>$D,"CharacterSet"=>"UTF-8");$O=adminer()->connectSsl();if(isset($O["Encrypt"]))$db["Encrypt"]=$O["Encrypt"];if(isset($O["TrustServerCertificate"]))$db["TrustServerCertificate"]=$O["TrustServerCertificate"];$i=adminer()->database();if($i!="")$db["Database"]=$i;$this->link=@sqlsrv_connect(preg_replace('~:~',',',$M),$db);if($this->link){$gd=sqlsrv_server_info($this->link);$this->server_info=$gd['SQLServerVersion'];}else$this->get_error();return($this->link?'':$this->error);}function
quote($Q){$Dg=strlen($Q)!=strlen(utf8_decode($Q));return($Dg?"N":"")."'".str_replace("'","''",$Q)."'";}function
select_db($rb){return$this->query(use_sql($rb));}function
query($F,$Cg=false){$G=sqlsrv_query($this->link,$F);$this->error="";if(!$G){$this->get_error();return
false;}return$this->store_result($G);}function
multi_query($F){$this->result=sqlsrv_query($this->link,$F);$this->error="";if(!$this->result){$this->get_error();return
false;}return
true;}function
store_result($G=null){if(!$G)$G=$this->result;if(!$G)return
false;if(sqlsrv_field_metadata($G))return
new
Result($G);$this->affected_rows=sqlsrv_rows_affected($G);return
true;}function
next_result(){return$this->result?!!sqlsrv_next_result($this->result):false;}}class
Result{var$num_rows;private$result,$offset=0,$fields;function
__construct($G){$this->result=$G;}private
function
convert($I){foreach((array)$I
as$w=>$X){if(is_a($X,'DateTime'))$I[$w]=$X->format("Y-m-d H:i:s");}return$I;}function
fetch_assoc(){return$this->convert(sqlsrv_fetch_array($this->result,SQLSRV_FETCH_ASSOC));}function
fetch_row(){return$this->convert(sqlsrv_fetch_array($this->result,SQLSRV_FETCH_NUMERIC));}function
fetch_field(){if(!$this->fields)$this->fields=sqlsrv_field_metadata($this->result);$l=$this->fields[$this->offset++];$H=new
\stdClass;$H->name=$l["Name"];$H->type=($l["Type"]==1?254:15);$H->charsetnr=0;return$H;}function
seek($ke){for($r=0;$r<$ke;$r++)sqlsrv_fetch($this->result);}function
__destruct(){sqlsrv_free_stmt($this->result);}}function
last_id($G){return
get_val("SELECT SCOPE_IDENTITY()");}function
explain($g,$F){$g->query("SET SHOWPLAN_ALL ON");$H=$g->query($F);$g->query("SET SHOWPLAN_ALL OFF");return$H;}}else{abstract
class
MssqlDb
extends
PdoDb{function
select_db($rb){return$this->query(use_sql($rb));}function
lastInsertId(){return$this->pdo->lastInsertId();}}function
last_id($G){return
connection()->lastInsertId();}function
explain($g,$F){}if(extension_loaded("pdo_sqlsrv")){class
Db
extends
MssqlDb{var$extension="PDO_SQLSRV";function
attach($M,$V,$D){return$this->dsn("sqlsrv:Server=".str_replace(":",",",$M),$V,$D);}}}elseif(extension_loaded("pdo_dblib")){class
Db
extends
MssqlDb{var$extension="PDO_DBLIB";function
attach($M,$V,$D){return$this->dsn("dblib:charset=utf8;host=".str_replace(":",";unix_socket=",preg_replace('~:(\d)~',';port=\1',$M)),$V,$D);}}}}class
Driver
extends
SqlDriver{static$cc=array("SQLSRV","PDO_SQLSRV","PDO_DBLIB");static$td="mssql";var$insertFunctions=array("date|time"=>"getdate");var$editFunctions=array("int|decimal|real|float|money|datetime"=>"+/-","char|text"=>"+",);var$operators=array("=","<",">","<=",">=","!=","LIKE","LIKE %%","IN","IS NULL","NOT LIKE","NOT IN","IS NOT NULL");var$functions=array("len","lower","round","upper");var$grouping=array("avg","count","count distinct","max","min","sum");var$generated=array("PERSISTED","VIRTUAL");var$onActions="NO ACTION|CASCADE|SET NULL|SET DEFAULT";static
function
connect($M,$V,$D){if($M=="")$M="localhost:1433";return
parent::connect($M,$V,$D);}function
__construct(Db$g){parent::__construct($g);$this->types=array(lang(25)=>array("tinyint"=>3,"smallint"=>5,"int"=>10,"bigint"=>20,"bit"=>1,"decimal"=>0,"real"=>12,"float"=>53,"smallmoney"=>10,"money"=>20),lang(26)=>array("date"=>10,"smalldatetime"=>19,"datetime"=>19,"datetime2"=>19,"time"=>8,"datetimeoffset"=>10),lang(27)=>array("char"=>8000,"varchar"=>8000,"text"=>2147483647,"nchar"=>4000,"nvarchar"=>4000,"ntext"=>1073741823),lang(28)=>array("binary"=>8000,"varbinary"=>8000,"image"=>2147483647),);}function
insertUpdate($R,array$J,array$E){$m=fields($R);$Kg=array();$Z=array();$N=reset($J);$e="c".implode(", c",range(1,count($N)));$Ha=0;$kd=array();foreach($N
as$w=>$X){$Ha++;$B=idf_unescape($w);if(!$m[$B]["auto_increment"])$kd[$w]="c$Ha";if(isset($E[$B]))$Z[]="$w = c$Ha";else$Kg[]="$w = c$Ha";}$Rg=array();foreach($J
as$N)$Rg[]="(".implode(", ",$N).")";if($Z){$Yc=queries("SET IDENTITY_INSERT ".table($R)." ON");$H=queries("MERGE ".table($R)." USING (VALUES\n\t".implode(",\n\t",$Rg)."\n) AS source ($e) ON ".implode(" AND ",$Z).($Kg?"\nWHEN MATCHED THEN UPDATE SET ".implode(", ",$Kg):"")."\nWHEN NOT MATCHED THEN INSERT (".implode(", ",array_keys($Yc?$N:$kd)).") VALUES (".($Yc?$e:implode(", ",$kd)).");");if($Yc)queries("SET IDENTITY_INSERT ".table($R)." OFF");}else$H=queries("INSERT INTO ".table($R)." (".implode(", ",array_keys($N)).") VALUES\n".implode(",\n",$Rg));return$H;}function
begin(){return
queries("BEGIN TRANSACTION");}function
tableHelp($B,$sd=false){$Fd=array("sys"=>"catalog-views/sys-","INFORMATION_SCHEMA"=>"information-schema-views/",);$z=$Fd[get_schema()];if($z)return"relational-databases/system-$z".preg_replace('~_~','-',strtolower($B))."-transact-sql";}}function
idf_escape($t){return"[".str_replace("]","]]",$t)."]";}function
table($t){return($_GET["ns"]!=""?idf_escape($_GET["ns"]).".":"").idf_escape($t);}function
get_databases($rc){return
get_vals("SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')");}function
limit($F,$Z,$y,$ke=0,$L=" "){return($y?" TOP (".($y+$ke).")":"")." $F$Z";}function
limit1($R,$F,$Z,$L="\n"){return
limit($F,$Z,1,0,$L);}function
db_collation($i,$Ua){return
get_val("SELECT collation_name FROM sys.databases WHERE name = ".q($i));}function
logged_user(){return
get_val("SELECT SUSER_NAME()");}function
tables_list(){return
get_key_vals("SELECT name, type_desc FROM sys.all_objects WHERE schema_id = SCHEMA_ID(".q(get_schema()).") AND type IN ('S', 'U', 'V') ORDER BY name");}function
count_tables($sb){$H=array();foreach($sb
as$i){connection()->select_db($i);$H[$i]=get_val("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES");}return$H;}function
table_status($B=""){$H=array();foreach(get_rows("SELECT ao.name AS Name, ao.type_desc AS Engine, (SELECT value FROM fn_listextendedproperty(default, 'SCHEMA', schema_name(schema_id), 'TABLE', ao.name, null, null)) AS Comment
FROM sys.all_objects AS ao
WHERE schema_id = SCHEMA_ID(".q(get_schema()).") AND type IN ('S', 'U', 'V') ".($B!=""?"AND name = ".q($B):"ORDER BY name"))as$I)$H[$I["Name"]]=$I;return$H;}function
is_view($S){return$S["Engine"]=="VIEW";}function
fk_support($S){return
true;}function
fields($R){$Za=get_key_vals("SELECT objname, cast(value as varchar(max)) FROM fn_listextendedproperty('MS_DESCRIPTION', 'schema', ".q(get_schema()).", 'table', ".q($R).", 'column', NULL)");$H=array();$Zf=get_val("SELECT object_id FROM sys.all_objects WHERE schema_id = SCHEMA_ID(".q(get_schema()).") AND type IN ('S', 'U', 'V') AND name = ".q($R));foreach(get_rows("SELECT c.max_length, c.precision, c.scale, c.name, c.is_nullable, c.is_identity, c.collation_name, t.name type, d.definition [default], d.name default_constraint, i.is_primary_key
FROM sys.all_columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
LEFT JOIN sys.default_constraints d ON c.default_object_id = d.object_id
LEFT JOIN sys.index_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
LEFT JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
WHERE c.object_id = ".q($Zf))as$I){$U=$I["type"];$x=(preg_match("~char|binary~",$U)?intval($I["max_length"])/($U[0]=='n'?2:1):($U=="decimal"?"$I[precision],$I[scale]":""));$H[$I["name"]]=array("field"=>$I["name"],"full_type"=>$U.($x?"($x)":""),"type"=>$U,"length"=>$x,"default"=>(preg_match("~^\('(.*)'\)$~",$I["default"],$_)?str_replace("''","'",$_[1]):$I["default"]),"default_constraint"=>$I["default_constraint"],"null"=>$I["is_nullable"],"auto_increment"=>$I["is_identity"],"collation"=>$I["collation_name"],"privileges"=>array("insert"=>1,"select"=>1,"update"=>1,"where"=>1,"order"=>1),"primary"=>$I["is_primary_key"],"comment"=>$Za[$I["name"]],);}foreach(get_rows("SELECT * FROM sys.computed_columns WHERE object_id = ".q($Zf))as$I){$H[$I["name"]]["generated"]=($I["is_persisted"]?"PERSISTED":"VIRTUAL");$H[$I["name"]]["default"]=$I["definition"];}return$H;}function
indexes($R,$h=null){$H=array();foreach(get_rows("SELECT i.name, key_ordinal, is_unique, is_primary_key, c.name AS column_name, is_descending_key
FROM sys.indexes i
INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE OBJECT_NAME(i.object_id) = ".q($R),$h)as$I){$B=$I["name"];$H[$B]["type"]=($I["is_primary_key"]?"PRIMARY":($I["is_unique"]?"UNIQUE":"INDEX"));$H[$B]["lengths"]=array();$H[$B]["columns"][$I["key_ordinal"]]=$I["column_name"];$H[$B]["descs"][$I["key_ordinal"]]=($I["is_descending_key"]?'1':null);}return$H;}function
view($B){return
array("select"=>preg_replace('~^(?:[^[]|\[[^]]*])*\s+AS\s+~isU','',get_val("SELECT VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ".q($B))));}function
collations(){$H=array();foreach(get_vals("SELECT name FROM fn_helpcollations()")as$c)$H[preg_replace('~_.*~','',$c)][]=$c;return$H;}function
information_schema($i){return
get_schema()=="INFORMATION_SCHEMA";}function
error(){return
nl_br(h(preg_replace('~^(\[[^]]*])+~m','',connection()->error)));}function
create_database($i,$c){return
queries("CREATE DATABASE ".idf_escape($i).(preg_match('~^[a-z0-9_]+$~i',$c)?" COLLATE $c":""));}function
drop_databases($sb){return
queries("DROP DATABASE ".implode(", ",array_map('Adminer\idf_escape',$sb)));}function
rename_database($B,$c){if(preg_match('~^[a-z0-9_]+$~i',$c))queries("ALTER DATABASE ".idf_escape(DB)." COLLATE $c");queries("ALTER DATABASE ".idf_escape(DB)." MODIFY NAME = ".idf_escape($B));return
true;}function
auto_increment(){return" IDENTITY".($_POST["Auto_increment"]!=""?"(".number($_POST["Auto_increment"]).",1)":"")." PRIMARY KEY";}function
alter_table($R,$B,$m,$tc,$Ya,$Pb,$c,$ta,$Ke){$b=array();$Za=array();$Ae=fields($R);foreach($m
as$l){$d=idf_escape($l[0]);$X=$l[1];if(!$X)$b["DROP"][]=" COLUMN $d";else{$X[1]=preg_replace("~( COLLATE )'(\\w+)'~",'\1\2',$X[1]);$Za[$l[0]]=$X[5];unset($X[5]);if(preg_match('~ AS ~',$X[3]))unset($X[1],$X[2]);if($l[0]=="")$b["ADD"][]="\n  ".implode("",$X).($R==""?substr($tc[$X[0]],16+strlen($X[0])):"");else{$j=$X[3];unset($X[3]);unset($X[6]);if($d!=$X[0])queries("EXEC sp_rename ".q(table($R).".$d").", ".q(idf_unescape($X[0])).", 'COLUMN'");$b["ALTER COLUMN ".implode("",$X)][]="";$_e=$Ae[$l[0]];if(default_value($_e)!=$j){if($_e["default"]!==null)$b["DROP"][]=" ".idf_escape($_e["default_constraint"]);if($j)$b["ADD"][]="\n $j FOR $d";}}}}if($R=="")return
queries("CREATE TABLE ".table($B)." (".implode(",",(array)$b["ADD"])."\n)");if($R!=$B)queries("EXEC sp_rename ".q(table($R)).", ".q($B));if($tc)$b[""]=$tc;foreach($b
as$w=>$X){if(!queries("ALTER TABLE ".table($B)." $w".implode(",",$X)))return
false;}foreach($Za
as$w=>$X){$Ya=substr($X,9);queries("EXEC sp_dropextendedproperty @name = N'MS_Description', @level0type = N'Schema', @level0name = ".q(get_schema()).", @level1type = N'Table', @level1name = ".q($B).", @level2type = N'Column', @level2name = ".q($w));queries("EXEC sp_addextendedproperty
@name = N'MS_Description',
@value = $Ya,
@level0type = N'Schema',
@level0name = ".q(get_schema()).",
@level1type = N'Table',
@level1name = ".q($B).",
@level2type = N'Column',
@level2name = ".q($w));}return
true;}function
alter_indexes($R,$b){$u=array();$Db=array();foreach($b
as$X){if($X[2]=="DROP"){if($X[0]=="PRIMARY")$Db[]=idf_escape($X[1]);else$u[]=idf_escape($X[1])." ON ".table($R);}elseif(!queries(($X[0]!="PRIMARY"?"CREATE $X[0] ".($X[0]!="INDEX"?"INDEX ":"").idf_escape($X[1]!=""?$X[1]:uniqid($R."_"))." ON ".table($R):"ALTER TABLE ".table($R)." ADD PRIMARY KEY")." (".implode(", ",$X[2]).")"))return
false;}return(!$u||queries("DROP INDEX ".implode(", ",$u)))&&(!$Db||queries("ALTER TABLE ".table($R)." DROP ".implode(", ",$Db)));}function
found_rows($S,$Z){}function
foreign_keys($R){$H=array();$oe=array("CASCADE","NO ACTION","SET NULL","SET DEFAULT");foreach(get_rows("EXEC sp_fkeys @fktable_name = ".q($R).", @fktable_owner = ".q(get_schema()))as$I){$o=&$H[$I["FK_NAME"]];$o["db"]=$I["PKTABLE_QUALIFIER"];$o["ns"]=$I["PKTABLE_OWNER"];$o["table"]=$I["PKTABLE_NAME"];$o["on_update"]=$oe[$I["UPDATE_RULE"]];$o["on_delete"]=$oe[$I["DELETE_RULE"]];$o["source"][]=$I["FKCOLUMN_NAME"];$o["target"][]=$I["PKCOLUMN_NAME"];}return$H;}function
truncate_tables($T){return
apply_queries("TRUNCATE TABLE",$T);}function
drop_views($Vg){return
queries("DROP VIEW ".implode(", ",array_map('Adminer\table',$Vg)));}function
drop_tables($T){return
queries("DROP TABLE ".implode(", ",array_map('Adminer\table',$T)));}function
move_tables($T,$Vg,$cg){return
apply_queries("ALTER SCHEMA ".idf_escape($cg)." TRANSFER",array_merge($T,$Vg));}function
trigger($B,$R){if($B=="")return
array();$J=get_rows("SELECT s.name [Trigger],
CASE WHEN OBJECTPROPERTY(s.id, 'ExecIsInsertTrigger') = 1 THEN 'INSERT' WHEN OBJECTPROPERTY(s.id, 'ExecIsUpdateTrigger') = 1 THEN 'UPDATE' WHEN OBJECTPROPERTY(s.id, 'ExecIsDeleteTrigger') = 1 THEN 'DELETE' END [Event],
CASE WHEN OBJECTPROPERTY(s.id, 'ExecIsInsteadOfTrigger') = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END [Timing],
c.text
FROM sysobjects s
JOIN syscomments c ON s.id = c.id
WHERE s.xtype = 'TR' AND s.name = ".q($B));$H=reset($J);if($H)$H["Statement"]=preg_replace('~^.+\s+AS\s+~isU','',$H["text"]);return$H;}function
triggers($R){$H=array();foreach(get_rows("SELECT sys1.name,
CASE WHEN OBJECTPROPERTY(sys1.id, 'ExecIsInsertTrigger') = 1 THEN 'INSERT' WHEN OBJECTPROPERTY(sys1.id, 'ExecIsUpdateTrigger') = 1 THEN 'UPDATE' WHEN OBJECTPROPERTY(sys1.id, 'ExecIsDeleteTrigger') = 1 THEN 'DELETE' END [Event],
CASE WHEN OBJECTPROPERTY(sys1.id, 'ExecIsInsteadOfTrigger') = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END [Timing]
FROM sysobjects sys1
JOIN sysobjects sys2 ON sys1.parent_obj = sys2.id
WHERE sys1.xtype = 'TR' AND sys2.name = ".q($R))as$I)$H[$I["name"]]=array($I["Timing"],$I["Event"]);return$H;}function
trigger_options(){return
array("Timing"=>array("AFTER","INSTEAD OF"),"Event"=>array("INSERT","UPDATE","DELETE"),"Type"=>array("AS"),);}function
schemas(){return
get_vals("SELECT name FROM sys.schemas");}function
get_schema(){if($_GET["ns"]!="")return$_GET["ns"];return
get_val("SELECT SCHEMA_NAME()");}function
set_schema($sf){$_GET["ns"]=$sf;return
true;}function
create_sql($R,$ta,$Tf){if(is_view(table_status1($R))){$Ug=view($R);return"CREATE VIEW ".table($R)." AS $Ug[select]";}$m=array();$E=false;foreach(fields($R)as$B=>$l){$X=process_field($l,$l);if($X[6])$E=true;$m[]=implode("",$X);}foreach(indexes($R)as$B=>$u){if(!$E||$u["type"]!="PRIMARY"){$e=array();foreach($u["columns"]as$w=>$X)$e[]=idf_escape($X).($u["descs"][$w]?" DESC":"");$B=idf_escape($B);$m[]=($u["type"]=="INDEX"?"INDEX $B":"CONSTRAINT $B ".($u["type"]=="UNIQUE"?"UNIQUE":"PRIMARY KEY"))." (".implode(", ",$e).")";}}foreach(driver()->checkConstraints($R)as$B=>$La)$m[]="CONSTRAINT ".idf_escape($B)." CHECK ($La)";return"CREATE TABLE ".table($R)." (\n\t".implode(",\n\t",$m)."\n)";}function
foreign_keys_sql($R){$m=array();foreach(foreign_keys($R)as$tc)$m[]=ltrim(format_foreign_key($tc));return($m?"ALTER TABLE ".table($R)." ADD\n\t".implode(",\n\t",$m).";\n\n":"");}function
truncate_sql($R){return"TRUNCATE TABLE ".table($R);}function
use_sql($rb){return"USE ".idf_escape($rb);}function
trigger_sql($R){$H="";foreach(triggers($R)as$B=>$xg)$H
.=create_trigger(" ON ".table($R),trigger($B,$R)).";";return$H;}function
convert_field($l){}function
unconvert_field($l,$H){return$H;}function
support($gc){return
preg_match('~^(check|comment|columns|database|drop_col|dump|indexes|descidx|scheme|sql|table|trigger|view|view_trigger)$~',$gc);}}class
Adminer{static$md;var$error='';private$values=array();function
name(){return"<a href='https://www.adminer.org/editor/'".target_blank()." id='h1'>".lang(32)."</a>";}function
credentials(){return
array(SERVER,$_GET["username"],get_password());}function
connectSsl(){}function
permanentLogin($jb=false){return
password_file($jb);}function
bruteForceKey(){return$_SERVER["REMOTE_ADDR"];}function
serverName($M){}function
database(){if(connection()){$sb=adminer()->databases(false);return(!$sb?get_val("SELECT SUBSTRING_INDEX(CURRENT_USER, '@', 1)"):$sb[(information_schema($sb[0])?1:0)]);}}function
operators(){return
array("<=",">=");}function
schemas(){return
schemas();}function
databases($rc=true){return
get_databases($rc);}function
queryTimeout(){return
5;}function
headers(){}function
csp($mb){return$mb;}function
head($pb=null){return
true;}function
css(){$H=array();foreach(array("","-dark")as$Xd){$n="adminer$Xd.css";if(file_exists($n))$H[]="$n?v=".crc32(file_get_contents($n));}return$H;}function
loginForm(){echo"<table class='layout'>\n",adminer()->loginFormField('username','<tr><th>'.lang(33).'<td>',input_hidden("auth[driver]","server").'<input name="auth[username]" autofocus value="'.h($_GET["username"]).'" autocomplete="username" autocapitalize="off">'),adminer()->loginFormField('password','<tr><th>'.lang(34).'<td>','<input type="password" name="auth[password]" autocomplete="current-password">'),"</table>\n","<p><input type='submit' value='".lang(35)."'>\n",checkbox("auth[permanent]",1,$_COOKIE["adminer_permanent"],lang(36))."\n";}function
loginFormField($B,$Pc,$Y){return$Pc.$Y."\n";}function
login($Hd,$D){return
true;}function
tableName($Yf){return
h(isset($Yf["Engine"])?($Yf["Comment"]!=""?$Yf["Comment"]:$Yf["Name"]):"");}function
fieldName($l,$xe=0){return
h(preg_replace('~\s+\[.*\]$~','',($l["comment"]!=""?$l["comment"]:$l["field"])));}function
selectLinks($Yf,$N=""){$a=$Yf["Name"];if($N!==null)echo'<p class="tabs"><a href="'.h(ME.'edit='.urlencode($a).$N).'">'.lang(37)."</a>\n";}function
foreignKeys($R){return
foreign_keys($R);}function
backwardKeys($R,$Xf){$H=array();foreach(get_rows("SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ".q(adminer()->database())."
AND REFERENCED_TABLE_SCHEMA = ".q(adminer()->database())."
AND REFERENCED_TABLE_NAME = ".q($R)."
ORDER BY ORDINAL_POSITION",null,"")as$I)$H[$I["TABLE_NAME"]]["keys"][$I["CONSTRAINT_NAME"]][$I["COLUMN_NAME"]]=$I["REFERENCED_COLUMN_NAME"];foreach($H
as$w=>$X){$B=adminer()->tableName(table_status1($w,true));if($B!=""){$uf=preg_quote($Xf);$L="(:|\\s*-)?\\s+";$H[$w]["name"]=(preg_match("(^$uf$L(.+)|^(.+?)$L$uf\$)iu",$B,$_)?$_[2].$_[3]:$B);}else
unset($H[$w]);}return$H;}function
backwardKeysPrint($ya,$I){foreach($ya
as$R=>$xa){foreach($xa["keys"]as$Va){$z=ME.'select='.urlencode($R);$r=0;foreach($Va
as$d=>$X)$z
.=where_link($r++,$d,$I[$X]);echo"<a href='".h($z)."'>".h($xa["name"])."</a>";$z=ME.'edit='.urlencode($R);foreach($Va
as$d=>$X)$z
.="&set".urlencode("[".bracket_escape($d)."]")."=".urlencode($I[$X]);echo"<a href='".h($z)."' title='".lang(37)."'>+</a> ";}}}function
selectQuery($F,$Rf,$ec=false){return"<!--\n".str_replace("--","--><!-- ",$F)."\n(".format_time($Rf).")\n-->\n";}function
rowDescription($R){foreach(fields($R)as$l){if(preg_match("~varchar|character varying~",$l["type"]))return
idf_escape($l["field"]);}return"";}function
rowDescriptions($J,$vc){$H=$J;foreach($J[0]as$w=>$X){if(list($R,$s,$B)=$this->_foreignColumn($vc,$w)){$Zc=array();foreach($J
as$I)$Zc[$I[$w]]=q($I[$w]);$xb=$this->values[$R];if(!$xb)$xb=get_key_vals("SELECT $s, $B FROM ".table($R)." WHERE $s IN (".implode(", ",$Zc).")");foreach($J
as$be=>$I){if(isset($I[$w]))$H[$be][$w]=(string)$xb[$I[$w]];}}}return$H;}function
selectLink($X,$l){}function
selectVal($X,$z,$l,$Be){$H=$X;$z=h($z);if(preg_match('~blob|bytea~',$l["type"])&&!is_utf8($X)){$H=lang(38,strlen($Be));if(preg_match("~^(GIF|\xFF\xD8\xFF|\x89PNG\x0D\x0A\x1A\x0A)~",$Be))$H="<img src='$z' alt='$H'>";}if(like_bool($l)&&$H!="")$H=(preg_match('~^(1|t|true|y|yes|on)$~i',$X)?lang(39):lang(40));if($z)$H="<a href='$z'".(is_url($z)?target_blank():"").">$H</a>";if(preg_match('~date~',$l["type"]))$H="<div class='datetime'>$H</div>";return$H;}function
editVal($X,$l){if(preg_match('~date|timestamp~',$l["type"])&&$X!==null)return
preg_replace('~^(\d{2}(\d+))-(0?(\d+))-(0?(\d+))~',lang(41),$X);return$X;}function
selectColumnsPrint($K,$e){}function
selectSearchPrint($Z,$e,$v){$Z=(array)$_GET["where"];echo'<fieldset id="fieldset-search"><legend>'.lang(42)."</legend><div>\n";$wd=array();foreach($Z
as$w=>$X)$wd[$X["col"]]=$w;$r=0;$m=fields($_GET["select"]);foreach($e
as$B=>$wb){$l=$m[$B];if(preg_match("~enum~",$l["type"])||like_bool($l)){$w=$wd[$B];$r--;echo"<div>".h($wb).input_hidden("where[$r][col]",$B).":",(like_bool($l)?" <select name='where[$r][val]'>".optionlist(array(""=>"",lang(40),lang(39)),$Z[$w]["val"],true)."</select>":enum_input("checkbox"," name='where[$r][val][]'",$l,(array)$Z[$w]["val"],($l["null"]?0:null))),"</div>\n";unset($e[$B]);}elseif(is_array($ve=$this->foreignKeyOptions($_GET["select"],$B))){if($m[$B]["null"])$ve[0]='('.lang(7).')';$w=$wd[$B];$r--;echo"<div>".h($wb).input_hidden("where[$r][col]",$B).input_hidden("where[$r][op]","=").": <select name='where[$r][val]'>".optionlist($ve,idx($Z[$w],"val"),true)."</select></div>\n";unset($e[$B]);}}$r=0;foreach($Z
as$X){if(($X["col"]==""||$e[$X["col"]])&&"$X[col]$X[val]"!=""){echo"<div><select name='where[$r][col]'><option value=''>(".lang(43).")".optionlist($e,$X["col"],true)."</select>",html_select("where[$r][op]",array(-1=>"")+adminer()->operators(),$X["op"]),"<input type='search' name='where[$r][val]' value='".h($X["val"])."'>".script("mixin(qsl('input'), {onkeydown: selectSearchKeydown, onsearch: selectSearchSearch});","")."</div>\n";$r++;}}echo"<div><select name='where[$r][col]'><option value=''>(".lang(43).")".optionlist($e,null,true)."</select>",script("qsl('select').onchange = selectAddRow;",""),html_select("where[$r][op]",array(-1=>"")+adminer()->operators()),"<input type='search' name='where[$r][val]'></div>",script("mixin(qsl('input'), {onchange: function () { this.parentNode.firstChild.onchange(); }, onsearch: selectSearchSearch});"),"</div></fieldset>\n";}function
selectOrderPrint($xe,$e,$v){$ze=array();foreach($v
as$w=>$u){$xe=array();foreach($u["columns"]as$X)$xe[]=$e[$X];if(count(array_filter($xe,'strlen'))>1&&$w!="PRIMARY")$ze[$w]=implode(", ",$xe);}if($ze)echo'<fieldset><legend>'.lang(44)."</legend><div>","<select name='index_order'>".optionlist(array(""=>"")+$ze,(idx($_GET["order"],0)!=""?"":$_GET["index_order"]),true)."</select>","</div></fieldset>\n";if($_GET["order"])echo"<div style='display: none;'>".hidden_fields(array("order"=>array(1=>reset($_GET["order"])),"desc"=>($_GET["desc"]?array(1=>1):array()),))."</div>\n";}function
selectLimitPrint($y){echo"<fieldset><legend>".lang(45)."</legend><div>",html_select("limit",array("",50,100),$y),"</div></fieldset>\n";}function
selectLengthPrint($gg){}function
selectActionPrint($v){echo"<fieldset><legend>".lang(46)."</legend><div>","<input type='submit' value='".lang(47)."'>","</div></fieldset>\n";}function
selectCommandPrint(){return
true;}function
selectImportPrint(){return
true;}function
selectEmailPrint($Mb,$e){if($Mb){print_fieldset("email",lang(48),$_POST["email_append"]);echo"<div>",script("qsl('div').onkeydown = partialArg(bodyKeydown, 'email');"),"<p>".lang(49).": <input name='email_from' value='".h($_POST?$_POST["email_from"]:$_COOKIE["adminer_email"])."'>\n",lang(50).": <input name='email_subject' value='".h($_POST["email_subject"])."'>\n","<p><textarea name='email_message' rows='15' cols='75'>".h($_POST["email_message"].($_POST["email_append"]?'{$'."$_POST[email_addition]}":""))."</textarea>\n","<p>".script("qsl('p').onkeydown = partialArg(bodyKeydown, 'email_append');","").html_select("email_addition",$e,$_POST["email_addition"])."<input type='submit' name='email_append' value='".lang(11)."'>\n","<p>".lang(51).": <input type='file' name='email_files[]'>".script("qsl('input').onchange = emailFileChange;"),"<p>".(count($Mb)==1?input_hidden("email_field",key($Mb)):html_select("email_field",$Mb)),"<input type='submit' name='email' value='".lang(52)."'>".confirm(),"</div>\n","</div></fieldset>\n";}}function
selectColumnsProcess($e,$v){return
array(array(),array());}function
selectSearchProcess($m,$v){$H=array();foreach((array)$_GET["where"]as$w=>$Z){$Ta=$Z["col"];$re=$Z["op"];$X=$Z["val"];if(($w>=0&&$Ta!="")||$X!=""){$ab=array();foreach(($Ta!=""?array($Ta=>$m[$Ta]):$m)as$B=>$l){if($Ta!=""||is_numeric($X)||!preg_match(number_type(),$l["type"])){$B=idf_escape($B);if($Ta!=""&&$l["type"]=="enum")$ab[]=(in_array(0,$X)?"$B IS NULL OR ":"")."$B IN (".implode(", ",array_map('intval',$X)).")";else{$hg=preg_match('~char|text|enum|set~',$l["type"]);$Y=adminer()->processInput($l,(!$re&&$hg&&preg_match('~^[^%]+$~',$X)?"%$X%":$X));$ab[]=driver()->convertSearch($B,$Z,$l).($Y=="NULL"?" IS".($re==">="?" NOT":"")." $Y":(in_array($re,adminer()->operators())||$re=="="?" $re $Y":($hg?" LIKE $Y":" IN (".str_replace(",","', '",$Y).")")));if($w<0&&$X=="0")$ab[]="$B IS NULL";}}}$H[]=($ab?"(".implode(" OR ",$ab).")":"1 = 0");}}return$H;}function
selectOrderProcess($m,$v){$dd=$_GET["index_order"];if($dd!="")unset($_GET["order"][1]);if($_GET["order"])return
array(idf_escape(reset($_GET["order"])).($_GET["desc"]?" DESC":""));foreach(($dd!=""?array($v[$dd]):$v)as$u){if($dd!=""||$u["type"]=="INDEX"){$Jc=array_filter($u["descs"]);$wb=false;foreach($u["columns"]as$X){if(preg_match('~date|timestamp~',$m[$X]["type"])){$wb=true;break;}}$H=array();foreach($u["columns"]as$w=>$X)$H[]=idf_escape($X).(($Jc?$u["descs"][$w]:$wb)?" DESC":"");return$H;}}return
array();}function
selectLimitProcess(){return(isset($_GET["limit"])?intval($_GET["limit"]):50);}function
selectLengthProcess(){return"100";}function
selectEmailProcess($Z,$vc){if($_POST["email_append"])return
true;if($_POST["email"]){$zf=0;if($_POST["all"]||$_POST["check"]){$l=idf_escape($_POST["email_field"]);$Uf=$_POST["email_subject"];$Td=$_POST["email_message"];preg_match_all('~\{\$([a-z0-9_]+)\}~i',"$Uf.$Td",$A);$J=get_rows("SELECT DISTINCT $l".($A[1]?", ".implode(", ",array_map('Adminer\idf_escape',array_unique($A[1]))):"")." FROM ".table($_GET["select"])." WHERE $l IS NOT NULL AND $l != ''".($Z?" AND ".implode(" AND ",$Z):"").($_POST["all"]?"":" AND ((".implode(") OR (",array_map('Adminer\where_check',(array)$_POST["check"]))."))"));$m=fields($_GET["select"]);foreach(adminer()->rowDescriptions($J,$vc)as$I){$kf=array('{\\'=>'{');foreach($A[1]as$X)$kf['{$'."$X}"]=adminer()->editVal($I[$X],$m[$X]);$Lb=$I[$_POST["email_field"]];if(is_mail($Lb)&&send_mail($Lb,strtr($Uf,$kf),strtr($Td,$kf),$_POST["email_from"],$_FILES["email_files"]))$zf++;}}cookie("adminer_email",$_POST["email_from"]);redirect(remove_from_uri(),lang(53,$zf));}return
false;}function
selectQueryBuild($K,$Z,$Dc,$xe,$y,$C){return"";}function
messageQuery($F,$ig,$ec=false){return" <span class='time'>".@date("H:i:s")."</span><!--\n".str_replace("--","--><!-- ",$F)."\n".($ig?"($ig)\n":"")."-->";}function
editRowPrint($R,$m,$I,$Kg){}function
editFunctions($l){$H=array();if($l["null"]&&preg_match('~blob~',$l["type"]))$H["NULL"]=lang(7);$H[""]=($l["null"]||$l["auto_increment"]||like_bool($l)?"":"*");if(preg_match('~date|time~',$l["type"]))$H["now"]=lang(54);if(preg_match('~_(md5|sha1)$~i',$l["field"],$_))$H[]=strtolower($_[1]);return$H;}function
editInput($R,$l,$ra,$Y){if($l["type"]=="enum")return(isset($_GET["select"])?"<label><input type='radio'$ra value='-1' checked><i>".lang(8)."</i></label> ":"").enum_input("radio",$ra,$l,($Y||isset($_GET["select"])?$Y:""),($l["null"]?"":null));$ve=$this->foreignKeyOptions($R,$l["field"],$Y);if($ve!==null)return(is_array($ve)?"<select$ra>".optionlist($ve,$Y,true)."</select>":"<input value='".h($Y)."'$ra class='hidden'>"."<input value='".h($ve)."' class='jsonly'>"."<div></div>".script("qsl('input').oninput = partial(whisper, '".ME."script=complete&source=".urlencode($R)."&field=".urlencode($l["field"])."&value='); qsl('div').onclick = whisperClick;",""));if(like_bool($l))return'<input type="checkbox" value="1"'.(preg_match('~^(1|t|true|y|yes|on)$~i',$Y)?' checked':'')."$ra>";$Rc="";if(preg_match('~time~',$l["type"]))$Rc=lang(55);if(preg_match('~date|timestamp~',$l["type"]))$Rc=lang(56).($Rc?" [$Rc]":"");if($Rc)return"<input value='".h($Y)."'$ra> ($Rc)";if(preg_match('~_(md5|sha1)$~i',$l["field"]))return"<input type='password' value='".h($Y)."'$ra>";return'';}function
editHint($R,$l,$Y){return(preg_match('~\s+(\[.*\])$~',($l["comment"]!=""?$l["comment"]:$l["field"]),$_)?h(" $_[1]"):'');}function
processInput($l,$Y,$q=""){if($q=="now")return"$q()";$H=$Y;if(preg_match('~date|timestamp~',$l["type"])&&preg_match('(^'.str_replace('\$1','(?P<p1>\d*)',preg_replace('~(\\\\\\$([2-6]))~','(?P<p\2>\d{1,2})',preg_quote(lang(41)))).'(.*))',$Y,$_))$H=($_["p1"]!=""?$_["p1"]:($_["p2"]!=""?($_["p2"]<70?20:19).$_["p2"]:gmdate("Y")))."-$_[p3]$_[p4]-$_[p5]$_[p6]".end($_);$H=($l["type"]=="bit"&&preg_match('~^[0-9]+$~',$Y)?$H:q($H));if($Y==""&&like_bool($l))$H="'0'";elseif($Y==""&&($l["null"]||!preg_match('~char|text~',$l["type"])))$H="NULL";elseif(preg_match('~^(md5|sha1)$~',$q))$H="$q($H)";return
unconvert_field($l,$H);}function
dumpOutput(){return
array();}function
dumpFormat(){return
array('csv'=>'CSV,','csv;'=>'CSV;','tsv'=>'TSV');}function
dumpDatabase($i){}function
dumpTable($R,$Tf,$sd=0){echo"\xef\xbb\xbf";}function
dumpData($R,$Tf,$F){$G=connection()->query($F,1);if($G){while($I=$G->fetch_assoc()){if($Tf=="table"){dump_csv(array_keys($I));$Tf="INSERT";}dump_csv($I);}}}function
dumpFilename($Xc){return
friendly_url($Xc);}function
dumpHeaders($Xc,$Zd=false){$ac="csv";header("Content-Type: text/csv; charset=utf-8");return$ac;}function
dumpFooter(){}function
importServerPath(){}function
homepage(){return
true;}function
navigation($Wd){echo"<h1>".adminer()->name()." <span class='version'>".VERSION;$ee=$_COOKIE["adminer_version"];echo" <a href='https://www.adminer.org/editor/#download'".target_blank()." id='version'>".(version_compare(VERSION,$ee)<0?h($ee):"")."</a>","</span></h1>\n";switch_lang();if($Wd=="auth"){$mc=true;foreach((array)$_SESSION["pwds"]as$Sg=>$Ef){foreach($Ef[""]as$V=>$D){if($D!==null){if($mc){echo"<ul id='logins'>",script("mixin(qs('#logins'), {onmouseover: menuOver, onmouseout: menuOut});");$mc=false;}echo"<li><a href='".h(auth_url($Sg,"",$V))."'>".($V!=""?h($V):"<i>".lang(7)."</i>")."</a>\n";}}}}else{adminer()->databasesPrint($Wd);if($Wd!="db"&&$Wd!="ns"){$S=table_status('',true);if(!$S)echo"<p class='message'>".lang(9)."\n";else
adminer()->tablesPrint($S);}}}function
syntaxHighlighting($T){}function
databasesPrint($Wd){}function
tablesPrint($T){echo"<ul id='tables'>",script("mixin(qs('#tables'), {onmouseover: menuOver, onmouseout: menuOut});");foreach($T
as$I){echo'<li>';$B=adminer()->tableName($I);if($B!="")echo"<a href='".h(ME).'select='.urlencode($I["Name"])."'".bold($_GET["select"]==$I["Name"]||$_GET["edit"]==$I["Name"],"select")." title='".lang(57)."'>$B</a>\n";}echo"</ul>\n";}function
_foreignColumn($vc,$d){foreach((array)$vc[$d]as$uc){if(count($uc["source"])==1){$B=adminer()->rowDescription($uc["table"]);if($B!=""){$s=idf_escape($uc["target"][0]);return
array($uc["table"],$s,$B);}}}}private
function
foreignKeyOptions($R,$d,$Y=null){if(list($cg,$s,$B)=$this->_foreignColumn(column_foreign_keys($R),$d)){$H=&$this->values[$cg];if($H===null){$S=table_status1($cg);$H=($S["Rows"]>1000?"":array(""=>"")+get_key_vals("SELECT $s, $B FROM ".table($cg)." ORDER BY 2"));}if(!$H&&$Y!==null)return
get_val("SELECT $B FROM ".table($cg)." WHERE $s = ".q($Y));return$H;}}}class
Plugins{private
static$la=array('dumpFormat'=>true,'dumpOutput'=>true,'editRowPrint'=>true,'editFunctions'=>true);var$plugins;var$error='';private$hooks=array();function
__construct($Pe){if($Pe===null){$Pe=array();$Aa="adminer-plugins";if(is_dir($Aa)){foreach(glob("$Aa/*.php")as$n)$bd=include_once"./$n";}$Qc=" href='https://www.adminer.org/plugins/#use'".target_blank();if(file_exists("$Aa.php")){$bd=include_once"./$Aa.php";if(is_array($bd)){foreach($bd
as$Oe)$Pe[get_class($Oe)]=$Oe;}else$this->error
.=lang(58,"<b>$Aa.php</b>",$Qc)."<br>";}foreach(get_declared_classes()as$Qa){if(!$Pe[$Qa]&&preg_match('~^Adminer\w~i',$Qa)){$gf=new
\ReflectionClass($Qa);$fb=$gf->getConstructor();if($fb&&$fb->getNumberOfRequiredParameters())$this->error
.=lang(59,$Qc,"<b>$Qa</b>","<b>$Aa.php</b>")."<br>";else$Pe[$Qa]=new$Qa;}}}$this->plugins=$Pe;$ga=new
Adminer;$Pe[]=$ga;$gf=new
\ReflectionObject($ga);foreach($gf->getMethods()as$Vd){foreach($Pe
as$Oe){$B=$Vd->getName();if(method_exists($Oe,$B))$this->hooks[$B][]=$Oe;}}}function
__call($B,array$Ie){$ma=array();foreach($Ie
as$w=>$X)$ma[]=&$Ie[$w];$H=null;foreach($this->hooks[$B]as$Oe){$Y=call_user_func_array(array($Oe,$B),$ma);if($Y!==null){if(!self::$la[$B])return$Y;$H=$Y+(array)$H;}}return$H;}}if(function_exists('adminer_object'))Adminer::$md=adminer_object();elseif(is_dir("adminer-plugins")||file_exists("adminer-plugins.php"))Adminer::$md=new
Plugins(null);else
Adminer::$md=new
Adminer;SqlDriver::$Cb=array("server"=>"MySQL / MariaDB")+SqlDriver::$Cb;if(!defined('Adminer\DRIVER')){define('Adminer\DRIVER',"server");if(extension_loaded("mysqli")&&$_GET["ext"]!="pdo"){class
Db
extends
\MySQLi{static$md;var$extension="MySQLi",$flavor='';function
__construct(){parent::init();}function
attach($M,$V,$D){mysqli_report(MYSQLI_REPORT_OFF);list($Tc,$Qe)=explode(":",$M,2);$O=adminer()->connectSsl();if($O)$this->ssl_set($O['key'],$O['cert'],$O['ca'],'','');$H=@$this->real_connect(($M!=""?$Tc:ini_get("mysqli.default_host")),($M.$V!=""?$V:ini_get("mysqli.default_user")),($M.$V.$D!=""?$D:ini_get("mysqli.default_pw")),null,(is_numeric($Qe)?intval($Qe):ini_get("mysqli.default_port")),(is_numeric($Qe)?$Qe:null),($O?($O['verify']!==false?2048:64):0));$this->options(MYSQLI_OPT_LOCAL_INFILE,false);return($H?'':$this->error);}function
set_charset($Ka){if(parent::set_charset($Ka))return
true;parent::set_charset('utf8');return$this->query("SET NAMES $Ka");}function
next_result(){return
self::more_results()&&parent::next_result();}function
quote($Q){return"'".$this->escape_string($Q)."'";}}}elseif(extension_loaded("mysql")&&!((ini_bool("sql.safe_mode")||ini_bool("mysql.allow_local_infile"))&&extension_loaded("pdo_mysql"))){class
Db
extends
SqlDb{private$link;function
attach($M,$V,$D){if(ini_bool("mysql.allow_local_infile"))return
lang(60,"'mysql.allow_local_infile'","MySQLi","PDO_MySQL");$this->link=@mysql_connect(($M!=""?$M:ini_get("mysql.default_host")),("$M$V"!=""?$V:ini_get("mysql.default_user")),("$M$V$D"!=""?$D:ini_get("mysql.default_password")),true,131072);if(!$this->link)return
mysql_error();$this->server_info=mysql_get_server_info($this->link);return'';}function
set_charset($Ka){if(function_exists('mysql_set_charset')){if(mysql_set_charset($Ka,$this->link))return
true;mysql_set_charset('utf8',$this->link);}return$this->query("SET NAMES $Ka");}function
quote($Q){return"'".mysql_real_escape_string($Q,$this->link)."'";}function
select_db($rb){return
mysql_select_db($rb,$this->link);}function
query($F,$Cg=false){$G=@($Cg?mysql_unbuffered_query($F,$this->link):mysql_query($F,$this->link));$this->error="";if(!$G){$this->errno=mysql_errno($this->link);$this->error=mysql_error($this->link);return
false;}if($G===true){$this->affected_rows=mysql_affected_rows($this->link);$this->info=mysql_info($this->link);return
true;}return
new
Result($G);}}class
Result{var$num_rows;private$result;private$offset=0;function
__construct($G){$this->result=$G;$this->num_rows=mysql_num_rows($G);}function
fetch_assoc(){return
mysql_fetch_assoc($this->result);}function
fetch_row(){return
mysql_fetch_row($this->result);}function
fetch_field(){$H=mysql_fetch_field($this->result,$this->offset++);$H->orgtable=$H->table;$H->charsetnr=($H->blob?63:0);return$H;}function
__destruct(){mysql_free_result($this->result);}}}elseif(extension_loaded("pdo_mysql")){class
Db
extends
PdoDb{var$extension="PDO_MySQL";function
attach($M,$V,$D){$ve=array(\PDO::MYSQL_ATTR_LOCAL_INFILE=>false);$O=adminer()->connectSsl();if($O){if($O['key'])$ve[\PDO::MYSQL_ATTR_SSL_KEY]=$O['key'];if($O['cert'])$ve[\PDO::MYSQL_ATTR_SSL_CERT]=$O['cert'];if($O['ca'])$ve[\PDO::MYSQL_ATTR_SSL_CA]=$O['ca'];if(isset($O['verify']))$ve[\PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT]=$O['verify'];}return$this->dsn("mysql:charset=utf8;host=".str_replace(":",";unix_socket=",preg_replace('~:(\d)~',';port=\1',$M)),$V,$D,$ve);}function
set_charset($Ka){return$this->query("SET NAMES $Ka");}function
select_db($rb){return$this->query("USE ".idf_escape($rb));}function
query($F,$Cg=false){$this->pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,!$Cg);return
parent::query($F,$Cg);}}}class
Driver
extends
SqlDriver{static$cc=array("MySQLi","MySQL","PDO_MySQL");static$td="sql";var$unsigned=array("unsigned","zerofill","unsigned zerofill");var$operators=array("=","<",">","<=",">=","!=","LIKE","LIKE %%","REGEXP","IN","FIND_IN_SET","IS NULL","NOT LIKE","NOT REGEXP","NOT IN","IS NOT NULL","SQL");var$functions=array("char_length","date","from_unixtime","lower","round","floor","ceil","sec_to_time","time_to_sec","upper");var$grouping=array("avg","count","count distinct","group_concat","max","min","sum");static
function
connect($M,$V,$D){$g=parent::connect($M,$V,$D);if(is_string($g)){if(function_exists('iconv')&&!is_utf8($g)&&strlen($rf=iconv("windows-1250","utf-8",$g))>strlen($g))$g=$rf;return$g;}$g->set_charset(charset($g));$g->query("SET sql_quote_show_create = 1, autocommit = 1");$g->flavor=(preg_match('~MariaDB~',$g->server_info)?'maria':'mysql');add_driver(DRIVER,($g->flavor=='maria'?"MariaDB":"MySQL"));return$g;}function
__construct(Db$g){parent::__construct($g);$this->types=array(lang(25)=>array("tinyint"=>3,"smallint"=>5,"mediumint"=>8,"int"=>10,"bigint"=>20,"decimal"=>66,"float"=>12,"double"=>21),lang(26)=>array("date"=>10,"datetime"=>19,"timestamp"=>19,"time"=>10,"year"=>4),lang(27)=>array("char"=>255,"varchar"=>65535,"tinytext"=>255,"text"=>65535,"mediumtext"=>16777215,"longtext"=>4294967295),lang(61)=>array("enum"=>65535,"set"=>64),lang(28)=>array("bit"=>20,"binary"=>255,"varbinary"=>65535,"tinyblob"=>255,"blob"=>65535,"mediumblob"=>16777215,"longblob"=>4294967295),lang(30)=>array("geometry"=>0,"point"=>0,"linestring"=>0,"polygon"=>0,"multipoint"=>0,"multilinestring"=>0,"multipolygon"=>0,"geometrycollection"=>0),);$this->insertFunctions=array("char"=>"md5/sha1/password/encrypt/uuid","binary"=>"md5/sha1","date|time"=>"now",);$this->editFunctions=array(number_type()=>"+/-","date"=>"+ interval/- interval","time"=>"addtime/subtime","char|text"=>"concat",);if(min_version('5.7.8',10.2,$g))$this->types[lang(27)]["json"]=4294967295;if(min_version('',10.7,$g)){$this->types[lang(27)]["uuid"]=128;$this->insertFunctions['uuid']='uuid';}if(min_version(9,'',$g)){$this->types[lang(25)]["vector"]=16383;$this->insertFunctions['vector']='string_to_vector';}if(min_version(5.7,10.2,$g))$this->generated=array("STORED","VIRTUAL");}function
unconvertFunction(array$l){return(preg_match("~binary~",$l["type"])?"<code class='jush-sql'>UNHEX</code>":($l["type"]=="bit"?doc_link(array('sql'=>'bit-value-literals.html'),"<code>b''</code>"):(preg_match("~geometry|point|linestring|polygon~",$l["type"])?"<code class='jush-sql'>GeomFromText</code>":"")));}function
insert($R,array$N){return($N?parent::insert($R,$N):queries("INSERT INTO ".table($R)." ()\nVALUES ()"));}function
insertUpdate($R,array$J,array$E){$e=array_keys(reset($J));$Te="INSERT INTO ".table($R)." (".implode(", ",$e).") VALUES\n";$Rg=array();foreach($e
as$w)$Rg[$w]="$w = VALUES($w)";$Vf="\nON DUPLICATE KEY UPDATE ".implode(", ",$Rg);$Rg=array();$x=0;foreach($J
as$N){$Y="(".implode(", ",$N).")";if($Rg&&(strlen($Te)+$x+strlen($Y)+strlen($Vf)>1e6)){if(!queries($Te.implode(",\n",$Rg).$Vf))return
false;$Rg=array();$x=0;}$Rg[]=$Y;$x+=strlen($Y)+2;}return
queries($Te.implode(",\n",$Rg).$Vf);}function
slowQuery($F,$jg){if(min_version('5.7.8','10.1.2')){if($this->conn->flavor=='maria')return"SET STATEMENT max_statement_time=$jg FOR $F";elseif(preg_match('~^(SELECT\b)(.+)~is',$F,$_))return"$_[1] /*+ MAX_EXECUTION_TIME(".($jg*1000).") */ $_[2]";}}function
convertSearch($t,array$X,array$l){return(preg_match('~char|text|enum|set~',$l["type"])&&!preg_match("~^utf8~",$l["collation"])&&preg_match('~[\x80-\xFF]~',$X['val'])?"CONVERT($t USING ".charset($this->conn).")":$t);}function
warnings(){$G=$this->conn->query("SHOW WARNINGS");if($G&&$G->num_rows){ob_start();print_select_result($G);return
ob_get_clean();}}function
tableHelp($B,$sd=false){$Jd=($this->conn->flavor=='maria');if(information_schema(DB))return
strtolower("information-schema-".($Jd?"$B-table/":str_replace("_","-",$B)."-table.html"));if(DB=="mysql")return($Jd?"mysql$B-table/":"system-schema.html");}function
hasCStyleEscapes(){static$Ia;if($Ia===null){$Pf=get_val("SHOW VARIABLES LIKE 'sql_mode'",1,$this->conn);$Ia=(strpos($Pf,'NO_BACKSLASH_ESCAPES')===false);}return$Ia;}function
engines(){$H=array();foreach(get_rows("SHOW ENGINES")as$I){if(preg_match("~YES|DEFAULT~",$I["Support"]))$H[]=$I["Engine"];}return$H;}}function
idf_escape($t){return"`".str_replace("`","``",$t)."`";}function
table($t){return
idf_escape($t);}function
get_databases($rc){$H=get_session("dbs");if($H===null){$F="SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME";$H=($rc?slow_query($F):get_vals($F));restart_session();set_session("dbs",$H);stop_session();}return$H;}function
limit($F,$Z,$y,$ke=0,$L=" "){return" $F$Z".($y?$L."LIMIT $y".($ke?" OFFSET $ke":""):"");}function
limit1($R,$F,$Z,$L="\n"){return
limit($F,$Z,1,0,$L);}function
db_collation($i,array$Ua){$H=null;$jb=get_val("SHOW CREATE DATABASE ".idf_escape($i),1);if(preg_match('~ COLLATE ([^ ]+)~',$jb,$_))$H=$_[1];elseif(preg_match('~ CHARACTER SET ([^ ]+)~',$jb,$_))$H=$Ua[$_[1]][-1];return$H;}function
logged_user(){return
get_val("SELECT USER()");}function
tables_list(){return
get_key_vals("SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME");}function
count_tables(array$sb){$H=array();foreach($sb
as$i)$H[$i]=count(get_vals("SHOW TABLES IN ".idf_escape($i)));return$H;}function
table_status($B="",$fc=false){$H=array();foreach(get_rows($fc?"SELECT TABLE_NAME AS Name, ENGINE AS Engine, TABLE_COMMENT AS Comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ".($B!=""?"AND TABLE_NAME = ".q($B):"ORDER BY Name"):"SHOW TABLE STATUS".($B!=""?" LIKE ".q(addcslashes($B,"%_\\")):""))as$I){if($I["Engine"]=="InnoDB")$I["Comment"]=preg_replace('~(?:(.+); )?InnoDB free: .*~','\1',$I["Comment"]);if(!isset($I["Engine"]))$I["Comment"]="";if($B!="")$I["Name"]=$B;$H[$I["Name"]]=$I;}return$H;}function
is_view(array$S){return$S["Engine"]===null;}function
fk_support(array$S){return
preg_match('~InnoDB|IBMDB2I'.(min_version(5.6)?'|NDB':'').'~i',$S["Engine"]);}function
fields($R){$Jd=(connection()->flavor=='maria');$H=array();foreach(get_rows("SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ".q($R)." ORDER BY ORDINAL_POSITION")as$I){$l=$I["COLUMN_NAME"];$U=$I["COLUMN_TYPE"];$Cc=$I["GENERATION_EXPRESSION"];$dc=$I["EXTRA"];preg_match('~^(VIRTUAL|PERSISTENT|STORED)~',$dc,$Bc);preg_match('~^([^( ]+)(?:\((.+)\))?( unsigned)?( zerofill)?$~',$U,$Md);$j=$I["COLUMN_DEFAULT"];if($j!=""){$rd=preg_match('~text|json~',$Md[1]);if(!$Jd&&$rd)$j=preg_replace("~^(_\w+)?('.*')$~",'\2',stripslashes($j));if($Jd||$rd){$j=($j=="NULL"?null:preg_replace_callback("~^'(.*)'$~",function($_){return
stripslashes(str_replace("''","'",$_[1]));},$j));}if(!$Jd&&preg_match('~binary~',$Md[1])&&preg_match('~^0x(\w*)$~',$j,$_))$j=pack("H*",$_[1]);}$H[$l]=array("field"=>$l,"full_type"=>$U,"type"=>$Md[1],"length"=>$Md[2],"unsigned"=>ltrim($Md[3].$Md[4]),"default"=>($Bc?($Jd?$Cc:stripslashes($Cc)):$j),"null"=>($I["IS_NULLABLE"]=="YES"),"auto_increment"=>($dc=="auto_increment"),"on_update"=>(preg_match('~\bon update (\w+)~i',$dc,$_)?$_[1]:""),"collation"=>$I["COLLATION_NAME"],"privileges"=>array_flip(explode(",","$I[PRIVILEGES],where,order")),"comment"=>$I["COLUMN_COMMENT"],"primary"=>($I["COLUMN_KEY"]=="PRI"),"generated"=>($Bc[1]=="PERSISTENT"?"STORED":$Bc[1]),);}return$H;}function
indexes($R,$h=null){$H=array();foreach(get_rows("SHOW INDEX FROM ".table($R),$h)as$I){$B=$I["Key_name"];$H[$B]["type"]=($B=="PRIMARY"?"PRIMARY":($I["Index_type"]=="FULLTEXT"?"FULLTEXT":($I["Non_unique"]?($I["Index_type"]=="SPATIAL"?"SPATIAL":"INDEX"):"UNIQUE")));$H[$B]["columns"][]=$I["Column_name"];$H[$B]["lengths"][]=($I["Index_type"]=="SPATIAL"?null:$I["Sub_part"]);$H[$B]["descs"][]=null;}return$H;}function
foreign_keys($R){static$Le='(?:`(?:[^`]|``)+`|"(?:[^"]|"")+")';$H=array();$kb=get_val("SHOW CREATE TABLE ".table($R),1);if($kb){preg_match_all("~CONSTRAINT ($Le) FOREIGN KEY ?\\(((?:$Le,? ?)+)\\) REFERENCES ($Le)(?:\\.($Le))? \\(((?:$Le,? ?)+)\\)(?: ON DELETE (driver()->onActions))?(?: ON UPDATE (driver()->onActions))?~",$kb,$A,PREG_SET_ORDER);foreach($A
as$_){preg_match_all("~$Le~",$_[2],$Lf);preg_match_all("~$Le~",$_[5],$cg);$H[idf_unescape($_[1])]=array("db"=>idf_unescape($_[4]!=""?$_[3]:$_[4]),"table"=>idf_unescape($_[4]!=""?$_[4]:$_[3]),"source"=>array_map('Adminer\idf_unescape',$Lf[0]),"target"=>array_map('Adminer\idf_unescape',$cg[0]),"on_delete"=>($_[6]?:"RESTRICT"),"on_update"=>($_[7]?:"RESTRICT"),);}}return$H;}function
view($B){return
array("select"=>preg_replace('~^(?:[^`]|`[^`]*`)*\s+AS\s+~isU','',get_val("SHOW CREATE VIEW ".table($B),1)));}function
collations(){$H=array();foreach(get_rows("SHOW COLLATION")as$I){if($I["Default"])$H[$I["Charset"]][-1]=$I["Collation"];else$H[$I["Charset"]][]=$I["Collation"];}ksort($H);foreach($H
as$w=>$X)sort($H[$w]);return$H;}function
information_schema($i){return($i=="information_schema")||(min_version(5.5)&&$i=="performance_schema");}function
error(){return
h(preg_replace('~^You have an error.*syntax to use~U',"Syntax error",connection()->error));}function
create_database($i,$c){return
queries("CREATE DATABASE ".idf_escape($i).($c?" COLLATE ".q($c):""));}function
drop_databases(array$sb){$H=apply_queries("DROP DATABASE",$sb,'Adminer\idf_escape');restart_session();set_session("dbs",null);return$H;}function
rename_database($B,$c){$H=false;if(create_database($B,$c)){$T=array();$Vg=array();foreach(tables_list()as$R=>$U){if($U=='VIEW')$Vg[]=$R;else$T[]=$R;}$H=(!$T&&!$Vg)||move_tables($T,$Vg,$B);drop_databases($H?array(DB):array());}return$H;}function
auto_increment(){$ua=" PRIMARY KEY";if($_GET["create"]!=""&&$_POST["auto_increment_col"]){foreach(indexes($_GET["create"])as$u){if(in_array($_POST["fields"][$_POST["auto_increment_col"]]["orig"],$u["columns"],true)){$ua="";break;}if($u["type"]=="PRIMARY")$ua=" UNIQUE";}}return" AUTO_INCREMENT$ua";}function
alter_table($R,$B,array$m,array$tc,$Ya,$Pb,$c,$ta,$Ke){$b=array();foreach($m
as$l){if($l[1]){$j=$l[1][3];if(preg_match('~ GENERATED~',$j)){$l[1][3]=(connection()->flavor=='maria'?"":$l[1][2]);$l[1][2]=$j;}$b[]=($R!=""?($l[0]!=""?"CHANGE ".idf_escape($l[0]):"ADD"):" ")." ".implode($l[1]).($R!=""?$l[2]:"");}else$b[]="DROP ".idf_escape($l[0]);}$b=array_merge($b,$tc);$P=($Ya!==null?" COMMENT=".q($Ya):"").($Pb?" ENGINE=".q($Pb):"").($c?" COLLATE ".q($c):"").($ta!=""?" AUTO_INCREMENT=$ta":"");if($R=="")return
queries("CREATE TABLE ".table($B)." (\n".implode(",\n",$b)."\n)$P$Ke");if($R!=$B)$b[]="RENAME TO ".table($B);if($P)$b[]=ltrim($P);return($b||$Ke?queries("ALTER TABLE ".table($R)."\n".implode(",\n",$b).$Ke):true);}function
alter_indexes($R,$b){$Ja=array();foreach($b
as$X)$Ja[]=($X[2]=="DROP"?"\nDROP INDEX ".idf_escape($X[1]):"\nADD $X[0] ".($X[0]=="PRIMARY"?"KEY ":"").($X[1]!=""?idf_escape($X[1])." ":"")."(".implode(", ",$X[2]).")");return
queries("ALTER TABLE ".table($R).implode(",",$Ja));}function
truncate_tables(array$T){return
apply_queries("TRUNCATE TABLE",$T);}function
drop_views(array$Vg){return
queries("DROP VIEW ".implode(", ",array_map('Adminer\table',$Vg)));}function
drop_tables(array$T){return
queries("DROP TABLE ".implode(", ",array_map('Adminer\table',$T)));}function
move_tables(array$T,array$Vg,$cg){$jf=array();foreach($T
as$R)$jf[]=table($R)." TO ".idf_escape($cg).".".table($R);if(!$jf||queries("RENAME TABLE ".implode(", ",$jf))){$ub=array();foreach($Vg
as$R)$ub[table($R)]=view($R);connection()->select_db($cg);$i=idf_escape(DB);foreach($ub
as$B=>$Ug){if(!queries("CREATE VIEW $B AS ".str_replace(" $i."," ",$Ug["select"]))||!queries("DROP VIEW $i.$B"))return
false;}return
true;}return
false;}function
copy_tables(array$T,array$Vg,$cg){queries("SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");foreach($T
as$R){$B=($cg==DB?table("copy_$R"):idf_escape($cg).".".table($R));if(($_POST["overwrite"]&&!queries("\nDROP TABLE IF EXISTS $B"))||!queries("CREATE TABLE $B LIKE ".table($R))||!queries("INSERT INTO $B SELECT * FROM ".table($R)))return
false;foreach(get_rows("SHOW TRIGGERS LIKE ".q(addcslashes($R,"%_\\")))as$I){$xg=$I["Trigger"];if(!queries("CREATE TRIGGER ".($cg==DB?idf_escape("copy_$xg"):idf_escape($cg).".".idf_escape($xg))." $I[Timing] $I[Event] ON $B FOR EACH ROW\n$I[Statement];"))return
false;}}foreach($Vg
as$R){$B=($cg==DB?table("copy_$R"):idf_escape($cg).".".table($R));$Ug=view($R);if(($_POST["overwrite"]&&!queries("DROP VIEW IF EXISTS $B"))||!queries("CREATE VIEW $B AS $Ug[select]"))return
false;}return
true;}function
trigger($B,$R){if($B=="")return
array();$J=get_rows("SHOW TRIGGERS WHERE `Trigger` = ".q($B));return
reset($J);}function
triggers($R){$H=array();foreach(get_rows("SHOW TRIGGERS LIKE ".q(addcslashes($R,"%_\\")))as$I)$H[$I["Trigger"]]=array($I["Timing"],$I["Event"]);return$H;}function
trigger_options(){return
array("Timing"=>array("BEFORE","AFTER"),"Event"=>array("INSERT","UPDATE","DELETE"),"Type"=>array("FOR EACH ROW"),);}function
routine($B,$U){$ka=array("bool","boolean","integer","double precision","real","dec","numeric","fixed","national char","national varchar");$Mf="(?:\\s|/\\*[\s\S]*?\\*/|(?:#|-- )[^\n]*\n?|--\r?\n)";$Qb=driver()->enumLength;$Ag="((".implode("|",array_merge(array_keys(driver()->types()),$ka)).")\\b(?:\\s*\\(((?:[^'\")]|$Qb)++)\\))?"."\\s*(zerofill\\s*)?(unsigned(?:\\s+zerofill)?)?)(?:\\s*(?:CHARSET|CHARACTER\\s+SET)\\s*['\"]?([^'\"\\s,]+)['\"]?)?";$Le="$Mf*(".($U=="FUNCTION"?"":driver()->inout).")?\\s*(?:`((?:[^`]|``)*)`\\s*|\\b(\\S+)\\s+)$Ag";$jb=get_val("SHOW CREATE $U ".idf_escape($B),2);preg_match("~\\(((?:$Le\\s*,?)*)\\)\\s*".($U=="FUNCTION"?"RETURNS\\s+$Ag\\s+":"")."(.*)~is",$jb,$_);$m=array();preg_match_all("~$Le\\s*,?~is",$_[1],$A,PREG_SET_ORDER);foreach($A
as$He)$m[]=array("field"=>str_replace("``","`",$He[2]).$He[3],"type"=>strtolower($He[5]),"length"=>preg_replace_callback("~$Qb~s",'Adminer\normalize_enum',$He[6]),"unsigned"=>strtolower(preg_replace('~\s+~',' ',trim("$He[8] $He[7]"))),"null"=>true,"full_type"=>$He[4],"inout"=>strtoupper($He[1]),"collation"=>strtolower($He[9]),);return
array("fields"=>$m,"comment"=>get_val("SELECT ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = ".q($B)),)+($U!="FUNCTION"?array("definition"=>$_[11]):array("returns"=>array("type"=>$_[12],"length"=>$_[13],"unsigned"=>$_[15],"collation"=>$_[16]),"definition"=>$_[17],"language"=>"SQL",));}function
routines(){return
get_rows("SELECT ROUTINE_NAME AS SPECIFIC_NAME, ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()");}function
routine_languages(){return
array();}function
routine_id($B,array$I){return
idf_escape($B);}function
last_id($G){return
get_val("SELECT LAST_INSERT_ID()");}function
explain(Db$g,$F){return$g->query("EXPLAIN ".(min_version(5.1)&&!min_version(5.7)?"PARTITIONS ":"").$F);}function
found_rows(array$S,array$Z){return($Z||$S["Engine"]!="InnoDB"?null:$S["Rows"]);}function
create_sql($R,$ta,$Tf){$H=get_val("SHOW CREATE TABLE ".table($R),1);if(!$ta)$H=preg_replace('~ AUTO_INCREMENT=\d+~','',$H);return$H;}function
truncate_sql($R){return"TRUNCATE ".table($R);}function
use_sql($rb){return"USE ".idf_escape($rb);}function
trigger_sql($R){$H="";foreach(get_rows("SHOW TRIGGERS LIKE ".q(addcslashes($R,"%_\\")),null,"-- ")as$I)$H
.="\nCREATE TRIGGER ".idf_escape($I["Trigger"])." $I[Timing] $I[Event] ON ".table($I["Table"])." FOR EACH ROW\n$I[Statement];;\n";return$H;}function
show_variables(){return
get_rows("SHOW VARIABLES");}function
show_status(){return
get_rows("SHOW STATUS");}function
process_list(){return
get_rows("SHOW FULL PROCESSLIST");}function
convert_field(array$l){if(preg_match("~binary~",$l["type"]))return"HEX(".idf_escape($l["field"]).")";if($l["type"]=="bit")return"BIN(".idf_escape($l["field"])." + 0)";if(preg_match("~geometry|point|linestring|polygon~",$l["type"]))return(min_version(8)?"ST_":"")."AsWKT(".idf_escape($l["field"]).")";}function
unconvert_field(array$l,$H){if(preg_match("~binary~",$l["type"]))$H="UNHEX($H)";if($l["type"]=="bit")$H="CONVERT(b$H, UNSIGNED)";if(preg_match("~geometry|point|linestring|polygon~",$l["type"])){$Te=(min_version(8)?"ST_":"");$H=$Te."GeomFromText($H, $Te"."SRID($l[field]))";}return$H;}function
support($gc){return!preg_match("~scheme|sequence|type|view_trigger|materializedview".(min_version(8)?"":"|descidx".(min_version(5.1)?"":"|event|partitioning")).(min_version('8.0.16','10.2.1')?"":"|check")."~",$gc);}function
kill_process($X){return
queries("KILL ".number($X));}function
connection_id(){return"SELECT CONNECTION_ID()";}function
max_connections(){return
get_val("SELECT @@max_connections");}function
types(){return
array();}function
type_values($s){return"";}function
schemas(){return
array();}function
get_schema(){return"";}function
set_schema($sf,$h=null){return
true;}}define('Adminer\JUSH',Driver::$td);define('Adminer\SERVER',$_GET[DRIVER]);define('Adminer\DB',$_GET["db"]);define('Adminer\ME',preg_replace('~\?.*~','',relative_uri()).'?'.(sid()?SID.'&':'').(SERVER!==null?DRIVER."=".urlencode(SERVER).'&':'').($_GET["ext"]?"ext=".urlencode($_GET["ext"]).'&':'').(isset($_GET["username"])?"username=".urlencode($_GET["username"]).'&':'').(DB!=""?'db='.urlencode(DB).'&'.(isset($_GET["ns"])?"ns=".urlencode($_GET["ns"])."&":""):''));function
page_header($lg,$k="",$Ga=array(),$mg=""){page_headers();if(is_ajax()&&$k){page_messages($k);exit;}if(!ob_get_level())ob_start(null,4096);$ng=$lg.($mg!=""?": $mg":"");$og=strip_tags($ng.(SERVER!=""&&SERVER!="localhost"?h(" - ".SERVER):"")." - ".adminer()->name());echo'<!DOCTYPE html>
<html lang="',LANG,'" dir="',lang(62),'">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>',$og,'</title>
<link rel="stylesheet" href="',h(preg_replace("~\\?.*~","",ME)."?file=default.css&version=5.1.1"),'">
';$nb=adminer()->css();$Lc=false;$Ic=false;foreach($nb
as$n){if(strpos($n,"adminer.css")!==false)$Lc=true;if(strpos($n,"adminer-dark.css")!==false)$Ic=true;}$pb=($Lc?($Ic?null:false):($Ic?:null));$Sd=" media='(prefers-color-scheme: dark)'";if($pb!==false)echo"<link rel='stylesheet'".($pb?"":$Sd)." href='".h(preg_replace("~\\?.*~","",ME)."?file=dark.css&version=5.1.1")."'>\n";echo"<meta name='color-scheme' content='".($pb===null?"light dark":($pb?"dark":"light"))."'>\n",script_src(preg_replace("~\\?.*~","",ME)."?file=functions.js&version=5.1.1");if(adminer()->head($pb))echo"<link rel='shortcut icon' type='image/x-icon' href='".h(preg_replace("~\\?.*~","",ME)."?file=favicon.ico&version=5.1.1")."'>\n","<link rel='apple-touch-icon' href='".h(preg_replace("~\\?.*~","",ME)."?file=favicon.ico&version=5.1.1")."'>\n";foreach($nb
as$X)echo"<link rel='stylesheet'".(preg_match('~-dark~',$X)&&!$pb?$Sd:"")." href='".h($X)."'>\n";echo"\n<body class='".lang(62)." nojs'>\n";$n=get_temp_dir()."/adminer.version";if(!$_COOKIE["adminer_version"]&&function_exists('openssl_verify')&&file_exists($n)&&filemtime($n)+86400>time()){$Tg=unserialize(file_get_contents($n));$Ye="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwqWOVuF5uw7/+Z70djoK
RlHIZFZPO0uYRezq90+7Amk+FDNd7KkL5eDve+vHRJBLAszF/7XKXe11xwliIsFs
DFWQlsABVZB3oisKCBEuI71J4kPH8dKGEWR9jDHFw3cWmoH3PmqImX6FISWbG3B8
h7FIx3jEaw5ckVPVTeo5JRm/1DZzJxjyDenXvBQ/6o9DgZKeNDgxwKzH+sw9/YCO
jHnq1cFpOIISzARlrHMa/43YfeNRAm/tsBXjSxembBPo7aQZLAWHmaj5+K19H10B
nCpz9Y++cipkVEiKRGih4ZEvjoFysEOdRLj6WiD/uUNky4xGeA6LaJqh5XpkFkcQ
fQIDAQAB
-----END PUBLIC KEY-----
";if(openssl_verify($Tg["version"],base64_decode($Tg["signature"]),$Ye)==1)$_COOKIE["adminer_version"]=$Tg["version"];}echo
script("mixin(document.body, {onkeydown: bodyKeydown, onclick: bodyClick".(isset($_COOKIE["adminer_version"])?"":", onload: partial(verifyVersion, '".VERSION."', '".js_escape(ME)."', '".get_token()."')")."});
document.body.classList.replace('nojs', 'js');
const offlineMessage = '".js_escape(lang(63))."';
const thousandsSeparator = '".js_escape(lang(4))."';"),"<div id='help' class='jush-".JUSH." jsonly hidden'></div>\n",script("mixin(qs('#help'), {onmouseover: () => { helpOpen = 1; }, onmouseout: helpMouseout});"),"<div id='content'>\n","<span id='menuopen' class='jsonly'>".icon("move","","menu","")."</span>".script("qs('#menuopen').onclick = event => { qs('#foot').classList.toggle('foot'); event.stopPropagation(); }");if($Ga!==null){$z=substr(preg_replace('~\b(username|db|ns)=[^&]*&~','',ME),0,-1);echo'<p id="breadcrumb"><a href="'.h($z?:".").'">'.get_driver(DRIVER).'</a> Â» ';$z=substr(preg_replace('~\b(db|ns)=[^&]*&~','',ME),0,-1);$M=adminer()->serverName(SERVER);$M=($M!=""?$M:lang(64));if($Ga===false)echo"$M\n";else{echo"<a href='".h($z)."' accesskey='1' title='Alt+Shift+1'>$M</a> Â» ";if($_GET["ns"]!=""||(DB!=""&&is_array($Ga)))echo'<a href="'.h($z."&db=".urlencode(DB).(support("scheme")?"&ns=":"")).'">'.h(DB).'</a> Â» ';if(is_array($Ga)){if($_GET["ns"]!="")echo'<a href="'.h(substr(ME,0,-1)).'">'.h($_GET["ns"]).'</a> Â» ';foreach($Ga
as$w=>$X){$wb=(is_array($X)?$X[1]:h($X));if($wb!="")echo"<a href='".h(ME."$w=").urlencode(is_array($X)?$X[0]:$X)."'>$wb</a> Â» ";}}echo"$lg\n";}}echo"<h2>$ng</h2>\n","<div id='ajaxstatus' class='jsonly hidden'></div>\n";restart_session();page_messages($k);$sb=&get_session("dbs");if(DB!=""&&$sb&&!in_array(DB,$sb,true))$sb=null;stop_session();define('Adminer\PAGE_HEADER',1);}function
page_headers(){header("Content-Type: text/html; charset=utf-8");header("Cache-Control: no-cache");header("X-Frame-Options: deny");header("X-XSS-Protection: 0");header("X-Content-Type-Options: nosniff");header("Referrer-Policy: origin-when-cross-origin");foreach(adminer()->csp(csp())as$mb){$Nc=array();foreach($mb
as$w=>$X)$Nc[]="$w $X";header("Content-Security-Policy: ".implode("; ",$Nc));}adminer()->headers();}function
csp(){return
array(array("script-src"=>"'self' 'unsafe-inline' 'nonce-".get_nonce()."' 'strict-dynamic'","connect-src"=>"'self'","frame-src"=>"https://www.adminer.org","object-src"=>"'none'","base-uri"=>"'none'","form-action"=>"'self'",),);}function
get_nonce(){static$ge;if(!$ge)$ge=base64_encode(rand_string());return$ge;}function
page_messages($k){$Lg=preg_replace('~^[^?]*~','',$_SERVER["REQUEST_URI"]);$Ud=idx($_SESSION["messages"],$Lg);if($Ud){echo"<div class='message'>".implode("</div>\n<div class='message'>",$Ud)."</div>".script("messagesPrint();");unset($_SESSION["messages"][$Lg]);}if($k)echo"<div class='error'>$k</div>\n";if(adminer()->error)echo"<div class='error'>".adminer()->error."</div>\n";}function
page_footer($Wd=""){echo"</div>\n\n<div id='foot' class='foot'>\n<div id='menu'>\n";adminer()->navigation($Wd);echo"</div>\n";if($Wd!="auth")echo'<form action="" method="post">
<p class="logout">
<span>',h($_GET["username"])."\n",'</span>
<input type="submit" name="logout" value="',lang(65),'" id="logout">
',input_token(),'</form>
';echo"</div>\n\n",script("setupSubmitHighlight(document);");}function
int32($be){while($be>=2147483648)$be-=4294967296;while($be<=-2147483649)$be+=4294967296;return(int)$be;}function
long2str(array$W,$Xg){$rf='';foreach($W
as$X)$rf
.=pack('V',$X);if($Xg)return
substr($rf,0,end($W));return$rf;}function
str2long($rf,$Xg){$W=array_values(unpack('V*',str_pad($rf,4*ceil(strlen($rf)/4),"\0")));if($Xg)$W[]=strlen($rf);return$W;}function
xxtea_mx($ch,$bh,$Wf,$ud){return
int32((($ch>>5&0x7FFFFFF)^$bh<<2)+(($bh>>3&0x1FFFFFFF)^$ch<<4))^int32(($Wf^$bh)+($ud^$ch));}function
encrypt_string($Sf,$w){if($Sf=="")return"";$w=array_values(unpack("V*",pack("H*",md5($w))));$W=str2long($Sf,true);$be=count($W)-1;$ch=$W[$be];$bh=$W[0];$Ze=floor(6+52/($be+1));$Wf=0;while($Ze-->0){$Wf=int32($Wf+0x9E3779B9);$Hb=$Wf>>2&3;for($Fe=0;$Fe<$be;$Fe++){$bh=$W[$Fe+1];$ae=xxtea_mx($ch,$bh,$Wf,$w[$Fe&3^$Hb]);$ch=int32($W[$Fe]+$ae);$W[$Fe]=$ch;}$bh=$W[0];$ae=xxtea_mx($ch,$bh,$Wf,$w[$Fe&3^$Hb]);$ch=int32($W[$be]+$ae);$W[$be]=$ch;}return
long2str($W,false);}function
decrypt_string($Sf,$w){if($Sf=="")return"";if(!$w)return
false;$w=array_values(unpack("V*",pack("H*",md5($w))));$W=str2long($Sf,false);$be=count($W)-1;$ch=$W[$be];$bh=$W[0];$Ze=floor(6+52/($be+1));$Wf=int32($Ze*0x9E3779B9);while($Wf){$Hb=$Wf>>2&3;for($Fe=$be;$Fe>0;$Fe--){$ch=$W[$Fe-1];$ae=xxtea_mx($ch,$bh,$Wf,$w[$Fe&3^$Hb]);$bh=int32($W[$Fe]-$ae);$W[$Fe]=$bh;}$ch=$W[$be];$ae=xxtea_mx($ch,$bh,$Wf,$w[$Fe&3^$Hb]);$bh=int32($W[0]-$ae);$W[0]=$bh;$Wf=int32($Wf-0x9E3779B9);}return
long2str($W,true);}$Ne=array();if($_COOKIE["adminer_permanent"]){foreach(explode(" ",$_COOKIE["adminer_permanent"])as$X){list($w)=explode(":",$X);$Ne[$w]=$X;}}function
add_invalid_login(){$_a=get_temp_dir()."/adminer.invalid";foreach(glob("$_a*")?:array($_a)as$n){$p=file_open_lock($n);if($p)break;}if(!$p)$p=file_open_lock("$_a-".rand_string());if(!$p)return;$od=unserialize(stream_get_contents($p));$ig=time();if($od){foreach($od
as$pd=>$X){if($X[0]<$ig)unset($od[$pd]);}}$nd=&$od[adminer()->bruteForceKey()];if(!$nd)$nd=array($ig+30*60,0);$nd[1]++;file_write_unlock($p,serialize($od));}function
check_invalid_login(array&$Ne){$od=array();foreach(glob(get_temp_dir()."/adminer.invalid*")as$n){$p=file_open_lock($n);if($p){$od=unserialize(stream_get_contents($p));file_unlock($p);break;}}$nd=idx($od,adminer()->bruteForceKey(),array());$fe=($nd[1]>29?$nd[0]-time():0);if($fe>0)auth_error(lang(66,ceil($fe/60)),$Ne);}$sa=$_POST["auth"];if($sa){session_regenerate_id();$Sg=$sa["driver"];$M=$sa["server"];$V=$sa["username"];$D=(string)$sa["password"];$i=$sa["db"];set_password($Sg,$M,$V,$D);$_SESSION["db"][$Sg][$M][$V][$i]=true;if($sa["permanent"]){$w=implode("-",array_map('base64_encode',array($Sg,$M,$V,$i)));$We=adminer()->permanentLogin(true);$Ne[$w]="$w:".base64_encode($We?encrypt_string($D,$We):"");cookie("adminer_permanent",implode(" ",$Ne));}if(count($_POST)==1||DRIVER!=$Sg||SERVER!=$M||$_GET["username"]!==$V||DB!=$i)redirect(auth_url($Sg,$M,$V,$i));}elseif($_POST["logout"]&&(!$_SESSION["token"]||verify_token())){foreach(array("pwds","db","dbs","queries")as$w)set_session($w,null);unset_permanent($Ne);redirect(substr(preg_replace('~\b(username|db|ns)=[^&]*&~','',ME),0,-1),lang(67).' '.lang(68));}elseif($Ne&&!$_SESSION["pwds"]){session_regenerate_id();$We=adminer()->permanentLogin();foreach($Ne
as$w=>$X){list(,$Pa)=explode(":",$X);list($Sg,$M,$V,$i)=array_map('base64_decode',explode("-",$w));set_password($Sg,$M,$V,decrypt_string(base64_decode($Pa),$We));$_SESSION["db"][$Sg][$M][$V][$i]=true;}}function
unset_permanent(array&$Ne){foreach($Ne
as$w=>$X){list($Sg,$M,$V,$i)=array_map('base64_decode',explode("-",$w));if($Sg==DRIVER&&$M==SERVER&&$V==$_GET["username"]&&$i==DB)unset($Ne[$w]);}cookie("adminer_permanent",implode(" ",$Ne));}function
auth_error($k,array&$Ne){$Ff=session_name();if(isset($_GET["username"])){header("HTTP/1.1 403 Forbidden");if(($_COOKIE[$Ff]||$_GET[$Ff])&&!$_SESSION["token"])$k=lang(69);else{restart_session();add_invalid_login();$D=get_password();if($D!==null){if($D===false)$k
.=($k?'<br>':'').lang(70,target_blank(),'<code>permanentLogin()</code>');set_password(DRIVER,SERVER,$_GET["username"],null);}unset_permanent($Ne);}}if(!$_COOKIE[$Ff]&&$_GET[$Ff]&&ini_bool("session.use_only_cookies"))$k=lang(71);$Ie=session_get_cookie_params();cookie("adminer_key",($_COOKIE["adminer_key"]?:rand_string()),$Ie["lifetime"]);if(!$_SESSION["token"])$_SESSION["token"]=rand(1,1e6);page_header(lang(35),$k,null);echo"<form action='' method='post'>\n","<div>";if(hidden_fields($_POST,array("auth")))echo"<p class='message'>".lang(72)."\n";echo"</div>\n";adminer()->loginForm();echo"</form>\n";page_footer("auth");exit;}if(isset($_GET["username"])&&!class_exists('Adminer\Db')){unset($_SESSION["pwds"][DRIVER]);unset_permanent($Ne);page_header(lang(73),lang(74,implode(", ",Driver::$cc)),false);page_footer("auth");exit;}$g='';if(isset($_GET["username"])&&is_string(get_password())){list($Tc,$Qe)=explode(":",SERVER,2);if(preg_match('~^\s*([-+]?\d+)~',$Qe,$_)&&($_[1]<1024||$_[1]>65535))auth_error(lang(75),$Ne);check_invalid_login($Ne);$lb=adminer()->credentials();$g=Driver::connect($lb[0],$lb[1],$lb[2]);if(is_object($g)){Db::$md=$g;Driver::$md=new
Driver($g);if($g->flavor)save_settings(array("vendor-".DRIVER."-".SERVER=>get_driver(DRIVER)));}}$Hd=null;if(!is_object($g)||($Hd=adminer()->login($_GET["username"],get_password()))!==true){$k=(is_string($g)?nl_br(h($g)):(is_string($Hd)?$Hd:lang(76))).(preg_match('~^ | $~',get_password())?'<br>'.lang(77):'');auth_error($k,$Ne);}if($_POST["logout"]&&$_SESSION["token"]&&!verify_token()){page_header(lang(65),lang(78));page_footer("db");exit;}if(!$_SESSION["token"])$_SESSION["token"]=rand(1,1e6);stop_session(true);if($sa&&$_POST["token"])$_POST["token"]=get_token();$k='';if($_POST){if(!verify_token()){$hd="max_input_vars";$Qd=ini_get($hd);if(extension_loaded("suhosin")){foreach(array("suhosin.request.max_vars","suhosin.post.max_vars")as$w){$X=ini_get($w);if($X&&(!$Qd||$X<$Qd)){$hd=$w;$Qd=$X;}}}$k=(!$_POST["token"]&&$Qd?lang(79,"'$hd'"):lang(78).' '.lang(80));}}elseif($_SERVER["REQUEST_METHOD"]=="POST"){$k=lang(81,"'post_max_size'");if(isset($_GET["sql"]))$k
.=' '.lang(82);}function
email_header($Nc){return"=?UTF-8?B?".base64_encode($Nc)."?=";}function
send_mail($Lb,$Uf,$Td,$zc="",array$kc=array()){$Tb=PHP_EOL;$Td=str_replace("\n",$Tb,wordwrap(str_replace("\r","","$Td\n")));$Fa=uniqid("boundary");$qa="";foreach((array)$kc["error"]as$w=>$X){if(!$X)$qa
.="--$Fa$Tb"."Content-Type: ".str_replace("\n","",$kc["type"][$w]).$Tb."Content-Disposition: attachment; filename=\"".preg_replace('~["\n]~','',$kc["name"][$w])."\"$Tb"."Content-Transfer-Encoding: base64$Tb$Tb".chunk_split(base64_encode(file_get_contents($kc["tmp_name"][$w])),76,$Tb).$Tb;}$Ba="";$Oc="Content-Type: text/plain; charset=utf-8$Tb"."Content-Transfer-Encoding: 8bit";if($qa){$qa
.="--$Fa--$Tb";$Ba="--$Fa$Tb$Oc$Tb$Tb";$Oc="Content-Type: multipart/mixed; boundary=\"$Fa\"";}$Oc
.=$Tb."MIME-Version: 1.0$Tb"."X-Mailer: Adminer Editor".($zc?$Tb."From: ".str_replace("\n","",$zc):"");return
mail($Lb,email_header($Uf),$Ba.$Td.$qa,$Oc);}function
like_bool(array$l){return
preg_match("~bool|(tinyint|bit)\\(1\\)~",$l["full_type"]);}connection()->select_db(adminer()->database());add_driver(DRIVER,lang(35));if(isset($_GET["select"])&&($_POST["edit"]||$_POST["clone"])&&!$_POST["save"])$_GET["edit"]=$_GET["select"];if(isset($_GET["download"])){$a=$_GET["download"];$m=fields($a);header("Content-Type: application/octet-stream");header("Content-Disposition: attachment; filename=".friendly_url("$a-".implode("_",$_GET["where"])).".".friendly_url($_GET["field"]));$K=array(idf_escape($_GET["field"]));$G=driver()->select($a,$K,array(where($_GET,$m)),$K);$I=($G?$G->fetch_row():array());echo
driver()->value($I[0],$m[$_GET["field"]]);exit;}elseif(isset($_GET["edit"])){$a=$_GET["edit"];$m=fields($a);$Z=(isset($_GET["select"])?($_POST["check"]&&count($_POST["check"])==1?where_check($_POST["check"][0],$m):""):where($_GET,$m));$Kg=(isset($_GET["select"])?$_POST["edit"]:$Z);foreach($m
as$B=>$l){if(!isset($l["privileges"][$Kg?"update":"insert"])||adminer()->fieldName($l)==""||$l["generated"])unset($m[$B]);}if($_POST&&!$k&&!isset($_GET["select"])){$Gd=$_POST["referer"];if($_POST["insert"])$Gd=($Kg?null:$_SERVER["REQUEST_URI"]);elseif(!preg_match('~^.+&select=.+$~',$Gd))$Gd=ME."select=".urlencode($a);$v=indexes($a);$Fg=unique_array($_GET["where"],$v);$cf="\nWHERE $Z";if(isset($_POST["delete"]))queries_redirect($Gd,lang(83),driver()->delete($a,$cf,$Fg?0:1));else{$N=array();foreach($m
as$B=>$l){$X=process_input($l);if($X!==false&&$X!==null)$N[idf_escape($B)]=$X;}if($Kg){if(!$N)redirect($Gd);queries_redirect($Gd,lang(84),driver()->update($a,$N,$cf,$Fg?0:1));if(is_ajax()){page_headers();page_messages($k);exit;}}else{$G=driver()->insert($a,$N);$Bd=($G?last_id($G):0);queries_redirect($Gd,lang(85,($Bd?" $Bd":"")),$G);}}}$I=null;if($_POST["save"])$I=(array)$_POST["fields"];elseif($Z){$K=array();foreach($m
as$B=>$l){if(isset($l["privileges"]["select"])){$oa=($_POST["clone"]&&$l["auto_increment"]?"''":convert_field($l));$K[]=($oa?"$oa AS ":"").idf_escape($B);}}$I=array();if(!support("table"))$K=array("*");if($K){$G=driver()->select($a,$K,array($Z),$K,array(),(isset($_GET["select"])?2:1));if(!$G)$k=error();else{$I=$G->fetch_assoc();if(!$I)$I=false;}if(isset($_GET["select"])&&(!$I||$G->fetch_assoc()))$I=null;}}if(!support("table")&&!$m){if(!$Z){$G=driver()->select($a,array("*"),array(),array("*"));$I=($G?$G->fetch_assoc():false);if(!$I)$I=array(driver()->primary=>"");}if($I){foreach($I
as$w=>$X){if(!$Z)$I[$w]=null;$m[$w]=array("field"=>$w,"null"=>($w!=driver()->primary),"auto_increment"=>($w==driver()->primary));}}}edit_form($a,$m,$I,$Kg,$k);}elseif(isset($_GET["select"])){$a=$_GET["select"];$S=table_status1($a);$v=indexes($a);$m=fields($a);$wc=column_foreign_keys($a);$le=$S["Oid"];$ha=get_settings("adminer_import");$pf=array();$e=array();$vf=array();$ye=array();$gg="";foreach($m
as$w=>$l){$B=adminer()->fieldName($l);$ce=html_entity_decode(strip_tags($B),ENT_QUOTES);if(isset($l["privileges"]["select"])&&$B!=""){$e[$w]=$ce;if(is_shortable($l))$gg=adminer()->selectLengthProcess();}if(isset($l["privileges"]["where"])&&$B!="")$vf[$w]=$ce;if(isset($l["privileges"]["order"])&&$B!="")$ye[$w]=$ce;$pf+=$l["privileges"];}list($K,$Dc)=adminer()->selectColumnsProcess($e,$v);$K=array_unique($K);$Dc=array_unique($Dc);$qd=count($Dc)<count($K);$Z=adminer()->selectSearchProcess($m,$v);$xe=adminer()->selectOrderProcess($m,$v);$y=adminer()->selectLimitProcess();if($_GET["val"]&&is_ajax()){header("Content-Type: text/plain; charset=utf-8");foreach($_GET["val"]as$Gg=>$I){$oa=convert_field($m[key($I)]);$K=array($oa?:idf_escape(key($I)));$Z[]=where_check($Gg,$m);$H=driver()->select($a,$K,$Z,$K);if($H)echo
first($H->fetch_row());}exit;}$E=$Ig=null;foreach($v
as$u){if($u["type"]=="PRIMARY"){$E=array_flip($u["columns"]);$Ig=($K?$E:array());foreach($Ig
as$w=>$X){if(in_array(idf_escape($w),$K))unset($Ig[$w]);}break;}}if($le&&!$E){$E=$Ig=array($le=>0);$v[]=array("type"=>"PRIMARY","columns"=>array($le));}if($_POST&&!$k){$Zg=$Z;if(!$_POST["all"]&&is_array($_POST["check"])){$Oa=array();foreach($_POST["check"]as$La)$Oa[]=where_check($La,$m);$Zg[]="((".implode(") OR (",$Oa)."))";}$Zg=($Zg?"\nWHERE ".implode(" AND ",$Zg):"");if($_POST["export"]){save_settings(array("output"=>$_POST["output"],"format"=>$_POST["format"]),"adminer_import");dump_headers($a);adminer()->dumpTable($a,"");$zc=($K?implode(", ",$K):"*").convert_fields($e,$m,$K)."\nFROM ".table($a);$Fc=($Dc&&$qd?"\nGROUP BY ".implode(", ",$Dc):"").($xe?"\nORDER BY ".implode(", ",$xe):"");$F="SELECT $zc$Zg$Fc";if(is_array($_POST["check"])&&!$E){$Eg=array();foreach($_POST["check"]as$X)$Eg[]="(SELECT".limit($zc,"\nWHERE ".($Z?implode(" AND ",$Z)." AND ":"").where_check($X,$m).$Fc,1).")";$F=implode(" UNION ALL ",$Eg);}adminer()->dumpData($a,"table",$F);adminer()->dumpFooter();exit;}if(!adminer()->selectEmailProcess($Z,$wc)){if($_POST["save"]||$_POST["delete"]){$G=true;$ia=0;$N=array();if(!$_POST["delete"]){foreach($_POST["fields"]as$B=>$X){$X=process_input($m[$B]);if($X!==null&&($_POST["clone"]||$X!==false))$N[idf_escape($B)]=($X!==false?$X:idf_escape($B));}}if($_POST["delete"]||$N){$F=($_POST["clone"]?"INTO ".table($a)." (".implode(", ",array_keys($N)).")\nSELECT ".implode(", ",$N)."\nFROM ".table($a):"");if($_POST["all"]||($E&&is_array($_POST["check"]))||$qd){$G=($_POST["delete"]?driver()->delete($a,$Zg):($_POST["clone"]?queries("INSERT $F$Zg".driver()->insertReturning($a)):driver()->update($a,$N,$Zg)));$ia=connection()->affected_rows;if(is_object($G))$ia+=$G->num_rows;}else{foreach((array)$_POST["check"]as$X){$Yg="\nWHERE ".($Z?implode(" AND ",$Z)." AND ":"").where_check($X,$m);$G=($_POST["delete"]?driver()->delete($a,$Yg,1):($_POST["clone"]?queries("INSERT".limit1($a,$F,$Yg)):driver()->update($a,$N,$Yg,1)));if(!$G)break;$ia+=connection()->affected_rows;}}}$Td=lang(86,$ia);if($_POST["clone"]&&$G&&$ia==1){$Bd=last_id($G);if($Bd)$Td=lang(85," $Bd");}queries_redirect(remove_from_uri($_POST["all"]&&$_POST["delete"]?"page":""),$Td,$G);if(!$_POST["delete"]){$Se=(array)$_POST["fields"];edit_form($a,array_intersect_key($m,$Se),$Se,!$_POST["clone"],$k);page_footer();exit;}}elseif(!$_POST["import"]){if(!$_POST["val"])$k=lang(87);else{$G=true;$ia=0;foreach($_POST["val"]as$Gg=>$I){$N=array();foreach($I
as$w=>$X){$w=bracket_escape($w,true);$N[idf_escape($w)]=(preg_match('~char|text~',$m[$w]["type"])||$X!=""?adminer()->processInput($m[$w],$X):"NULL");}$G=driver()->update($a,$N," WHERE ".($Z?implode(" AND ",$Z)." AND ":"").where_check($Gg,$m),($qd||$E?0:1)," ");if(!$G)break;$ia+=connection()->affected_rows;}queries_redirect(remove_from_uri(),lang(86,$ia),$G);}}elseif(!is_string($jc=get_file("csv_file",true)))$k=upload_error($jc);elseif(!preg_match('~~u',$jc))$k=lang(88);else{save_settings(array("output"=>$ha["output"],"format"=>$_POST["separator"]),"adminer_import");$G=true;$Va=array_keys($m);preg_match_all('~(?>"[^"]*"|[^"\r\n]+)+~',$jc,$A);$ia=count($A[0]);driver()->begin();$L=($_POST["separator"]=="csv"?",":($_POST["separator"]=="tsv"?"\t":";"));$J=array();foreach($A[0]as$w=>$X){preg_match_all("~((?>\"[^\"]*\")+|[^$L]*)$L~",$X.$L,$Nd);if(!$w&&!array_diff($Nd[1],$Va)){$Va=$Nd[1];$ia--;}else{$N=array();foreach($Nd[1]as$r=>$Ta)$N[idf_escape($Va[$r])]=($Ta==""&&$m[$Va[$r]]["null"]?"NULL":q(preg_match('~^".*"$~s',$Ta)?str_replace('""','"',substr($Ta,1,-1)):$Ta));$J[]=$N;}}$G=(!$J||driver()->insertUpdate($a,$J,$E));if($G)driver()->commit();queries_redirect(remove_from_uri("page"),lang(89,$ia),$G);driver()->rollback();}}}$ag=adminer()->tableName($S);if(is_ajax()){page_headers();ob_start();}else
page_header(lang(47).": $ag",$k);$N=null;if(isset($pf["insert"])||!support("table")){$Ie=array();foreach((array)$_GET["where"]as$X){if(isset($wc[$X["col"]])&&count($wc[$X["col"]])==1&&($X["op"]=="="||(!$X["op"]&&(is_array($X["val"])||!preg_match('~[_%]~',$X["val"])))))$Ie["set"."[".bracket_escape($X["col"])."]"]=$X["val"];}$N=$Ie?"&".http_build_query($Ie):"";}adminer()->selectLinks($S,$N);if(!$e&&support("table"))echo"<p class='error'>".lang(90).($m?".":": ".error())."\n";else{echo"<form action='' id='form'>\n","<div style='display: none;'>";hidden_fields_get();echo(DB!=""?input_hidden("db",DB).(isset($_GET["ns"])?input_hidden("ns",$_GET["ns"]):""):""),input_hidden("select",$a),"</div>\n";adminer()->selectColumnsPrint($K,$e);adminer()->selectSearchPrint($Z,$vf,$v);adminer()->selectOrderPrint($xe,$ye,$v);adminer()->selectLimitPrint($y);adminer()->selectLengthPrint($gg);adminer()->selectActionPrint($v);echo"</form>\n";$C=$_GET["page"];if($C=="last"){$yc=get_val(count_rows($a,$Z,$qd,$Dc));$C=floor(max(0,intval($yc)-1)/$y);}$wf=$K;$Ec=$Dc;if(!$wf){$wf[]="*";$hb=convert_fields($e,$m,$K);if($hb)$wf[]=substr($hb,2);}foreach($K
as$w=>$X){$l=$m[idf_unescape($X)];if($l&&($oa=convert_field($l)))$wf[$w]="$oa AS $X";}if(!$qd&&$Ig){foreach($Ig
as$w=>$X){$wf[]=idf_escape($w);if($Ec)$Ec[]=idf_escape($w);}}$G=driver()->select($a,$wf,$Z,$Ec,$xe,$y,$C,true);if(!$G)echo"<p class='error'>".error()."\n";else{if(JUSH=="mssql"&&$C)$G->seek($y*$C);$Nb=array();echo"<form action='' method='post' enctype='multipart/form-data'>\n";$J=array();while($I=$G->fetch_assoc()){if($C&&JUSH=="oracle")unset($I["RNUM"]);$J[]=$I;}if($_GET["page"]!="last"&&$y&&$Dc&&$qd&&JUSH=="sql")$yc=get_val(" SELECT FOUND_ROWS()");if(!$J)echo"<p class='message'>".lang(12)."\n";else{$za=adminer()->backwardKeys($a,$ag);echo"<div class='scrollable'>","<table id='table' class='nowrap checkable odds'>",script("mixin(qs('#table'), {onclick: tableClick, ondblclick: partialArg(tableClick, true), onkeydown: editingKeydown});"),"<thead><tr>".(!$Dc&&$K?"":"<td><input type='checkbox' id='all-page' class='jsonly'>".script("qs('#all-page').onclick = partial(formCheck, /check/);","")." <a href='".h($_GET["modify"]?remove_from_uri("modify"):$_SERVER["REQUEST_URI"]."&modify=1")."'>".lang(91)."</a>");$de=array();$Ac=array();reset($K);$ef=1;foreach($J[0]as$w=>$X){if(!isset($Ig[$w])){$X=idx($_GET["columns"],key($K))?:array();$l=$m[$K?($X?$X["col"]:current($K)):$w];$B=($l?adminer()->fieldName($l,$ef):($X["fun"]?"*":h($w)));if($B!=""){$ef++;$de[$w]=$B;$d=idf_escape($w);$Uc=remove_from_uri('(order|desc)[^=]*|page').'&order%5B0%5D='.urlencode($w);$wb="&desc%5B0%5D=1";echo"<th id='th[".h(bracket_escape($w))."]'>".script("mixin(qsl('th'), {onmouseover: partial(columnMouse), onmouseout: partial(columnMouse, ' hidden')});","");$_c=apply_sql_function($X["fun"],$B);$Kf=isset($l["privileges"]["order"])||$_c;echo($Kf?'<a href="'.h($Uc.($xe[0]==$d||$xe[0]==$w||(!$xe&&$qd&&$Dc[0]==$d)?$wb:'')).'">'."$_c</a>":$_c),"<span class='column hidden'>";if($Kf)echo"<a href='".h($Uc.$wb)."' title='".lang(92)."' class='text'> â†“</a>";if(!$X["fun"]&&isset($l["privileges"]["where"]))echo'<a href="#fieldset-search" title="'.lang(42).'" class="text jsonly"> =</a>',script("qsl('a').onclick = partial(selectSearch, '".js_escape($w)."');");echo"</span>";}$Ac[$w]=$X["fun"];next($K);}}$Dd=array();if($_GET["modify"]){foreach($J
as$I){foreach($I
as$w=>$X)$Dd[$w]=max($Dd[$w],min(40,strlen(utf8_decode($X))));}}echo($za?"<th>".lang(93):"")."</thead>\n";if(is_ajax())ob_end_clean();foreach(adminer()->rowDescriptions($J,$wc)as$be=>$I){$Fg=unique_array($J[$be],$v);if(!$Fg){$Fg=array();foreach($J[$be]as$w=>$X){if(!preg_match('~^(COUNT\((\*|(DISTINCT )?`(?:[^`]|``)+`)\)|(AVG|GROUP_CONCAT|MAX|MIN|SUM)\(`(?:[^`]|``)+`\))$~',$w))$Fg[$w]=$X;}}$Gg="";foreach($Fg
as$w=>$X){$l=(array)$m[$w];if((JUSH=="sql"||JUSH=="pgsql")&&preg_match('~char|text|enum|set~',$l["type"])&&strlen($X)>64){$w=(strpos($w,'(')?$w:idf_escape($w));$w="MD5(".(JUSH!='sql'||preg_match("~^utf8~",$l["collation"])?$w:"CONVERT($w USING ".charset(connection()).")").")";$X=md5($X);}$Gg
.="&".($X!==null?urlencode("where[".bracket_escape($w)."]")."=".urlencode($X===false?"f":$X):"null%5B%5D=".urlencode($w));}echo"<tr>".(!$Dc&&$K?"":"<td>".checkbox("check[]",substr($Gg,1),in_array(substr($Gg,1),(array)$_POST["check"])).($qd||information_schema(DB)?"":" <a href='".h(ME."edit=".urlencode($a).$Gg)."' class='edit'>".lang(94)."</a>"));foreach($I
as$w=>$X){if(isset($de[$w])){$l=(array)$m[$w];$X=driver()->value($X,$l);if($X!=""&&(!isset($Nb[$w])||$Nb[$w]!=""))$Nb[$w]=(is_mail($X)?$de[$w]:"");$z="";if(preg_match('~blob|bytea|raw|file~',$l["type"])&&$X!="")$z=ME.'download='.urlencode($a).'&field='.urlencode($w).$Gg;if(!$z&&$X!==null){foreach((array)$wc[$w]as$o){if(count($wc[$w])==1||end($o["source"])==$w){$z="";foreach($o["source"]as$r=>$Lf)$z
.=where_link($r,$o["target"][$r],$J[$be][$Lf]);$z=($o["db"]!=""?preg_replace('~([?&]db=)[^&]+~','\1'.urlencode($o["db"]),ME):ME).'select='.urlencode($o["table"]).$z;if($o["ns"])$z=preg_replace('~([?&]ns=)[^&]+~','\1'.urlencode($o["ns"]),$z);if(count($o["source"])==1)break;}}}if($w=="COUNT(*)"){$z=ME."select=".urlencode($a);$r=0;foreach((array)$_GET["where"]as$W){if(!array_key_exists($W["col"],$Fg))$z
.=where_link($r++,$W["col"],$W["val"],$W["op"]);}foreach($Fg
as$ud=>$W)$z
.=where_link($r++,$ud,$W);}$X=select_value($X,$z,$l,$gg);$s=h("val[$Gg][".bracket_escape($w)."]");$Y=idx(idx($_POST["val"],$Gg),bracket_escape($w));$Jb=!is_array($I[$w])&&is_utf8($X)&&$J[$be][$w]==$I[$w]&&!$Ac[$w]&&!$l["generated"];$eg=preg_match('~text|json|lob~',$l["type"]);echo"<td id='$s'".(preg_match(number_type(),$l["type"])&&($X=='<i>NULL</i>'||is_numeric(strip_tags($X)))?" class='number'":"");if(($_GET["modify"]&&$Jb)||$Y!==null){$Hc=h($Y!==null?$Y:$I[$w]);echo">".($eg?"<textarea name='$s' cols='30' rows='".(substr_count($I[$w],"\n")+1)."'>$Hc</textarea>":"<input name='$s' value='$Hc' size='$Dd[$w]'>");}else{$Id=strpos($X,"<i>â€¦</i>");echo" data-text='".($Id?2:($eg?1:0))."'".($Jb?"":" data-warning='".h(lang(95))."'").">$X";}}}if($za)echo"<td>";adminer()->backwardKeysPrint($za,$J[$be]);echo"</tr>\n";}if(is_ajax())exit;echo"</table>\n","</div>\n";}if(!is_ajax()){if($J||$C){$Yb=true;$yc=null;if($_GET["page"]!="last"){if(!$y||(count($J)<$y&&($J||!$C)))$yc=($C?$C*$y:0)+count($J);elseif(JUSH!="sql"||!$qd){$yc=($qd?false:found_rows($S,$Z));if(intval($yc)<max(1e4,2*($C+1)*$y))$yc=first(slow_query(count_rows($a,$Z,$qd,$Dc)));else$Yb=false;}}$Ge=($y&&($yc===false||$yc>$y||$C));if($Ge)echo(($yc===false?count($J)+1:$yc-$C*$y)>$y?'<p><a href="'.h(remove_from_uri("page")."&page=".($C+1)).'" class="loadmore">'.lang(96).'</a>'.script("qsl('a').onclick = partial(selectLoadMore, $y, '".lang(97)."â€¦');",""):''),"\n";echo"<div class='footer'><div>\n";if($Ge){$Od=($yc===false?$C+(count($J)>=$y?2:1):floor(($yc-1)/$y));echo"<fieldset>";if(JUSH!="simpledb"){echo"<legend><a href='".h(remove_from_uri("page"))."'>".lang(98)."</a></legend>",script("qsl('a').onclick = function () { pageClick(this.href, +prompt('".lang(98)."', '".($C+1)."')); return false; };"),pagination(0,$C).($C>5?" â€¦":"");for($r=max(1,$C-4);$r<min($Od,$C+5);$r++)echo
pagination($r,$C);if($Od>0)echo($C+5<$Od?" â€¦":""),($Yb&&$yc!==false?pagination($Od,$C):" <a href='".h(remove_from_uri("page")."&page=last")."' title='~$Od'>".lang(99)."</a>");}else
echo"<legend>".lang(98)."</legend>",pagination(0,$C).($C>1?" â€¦":""),($C?pagination($C,$C):""),($Od>$C?pagination($C+1,$C).($Od>$C+1?" â€¦":""):"");echo"</fieldset>\n";}echo"<fieldset>","<legend>".lang(100)."</legend>";$Ab=($Yb?"":"~ ").$yc;$qe="const checked = formChecked(this, /check/); selectCount('selected', this.checked ? '$Ab' : checked); selectCount('selected2', this.checked || !checked ? '$Ab' : checked);";echo
checkbox("all",1,0,($yc!==false?($Yb?"":"~ ").lang(101,$yc):""),$qe)."\n","</fieldset>\n";if(adminer()->selectCommandPrint())echo'<fieldset',($_GET["modify"]?'':' class="jsonly"'),'><legend>',lang(91),'</legend><div>
<input type="submit" value="',lang(14),'"',($_GET["modify"]?'':' title="'.lang(87).'"'),'>
</div></fieldset>
<fieldset><legend>',lang(102),' <span id="selected"></span></legend><div>
<input type="submit" name="edit" value="',lang(10),'">
<input type="submit" name="clone" value="',lang(103),'">
<input type="submit" name="delete" value="',lang(18),'">',confirm(),'</div></fieldset>
';$xc=adminer()->dumpFormat();foreach((array)$_GET["columns"]as$d){if($d["fun"]){unset($xc['sql']);break;}}if($xc){print_fieldset("export",lang(104)." <span id='selected2'></span>");$De=adminer()->dumpOutput();echo($De?html_select("output",$De,$ha["output"])." ":""),html_select("format",$xc,$ha["format"])," <input type='submit' name='export' value='".lang(104)."'>\n","</div></fieldset>\n";}adminer()->selectEmailPrint(array_filter($Nb,'strlen'),$e);echo"</div></div>\n";}if(adminer()->selectImportPrint())echo"<div>","<a href='#import'>".lang(105)."</a>",script("qsl('a').onclick = partial(toggle, 'import');",""),"<span id='import'".($_POST["import"]?"":" class='hidden'").">: ","<input type='file' name='csv_file'> ",html_select("separator",array("csv"=>"CSV,","csv;"=>"CSV;","tsv"=>"TSV"),$ha["format"])," <input type='submit' name='import' value='".lang(105)."'>","</span>","</div>";echo
input_token(),"</form>\n",(!$Dc&&$K?"":script("tableCheck();"));}}}if(is_ajax()){ob_end_clean();exit;}}elseif(isset($_GET["script"])){if($_GET["script"]=="kill")connection()->query("KILL ".number($_POST["kill"]));elseif(list($R,$s,$B)=adminer()->_foreignColumn(column_foreign_keys($_GET["source"]),$_GET["field"])){$y=11;$G=connection()->query("SELECT $s, $B FROM ".table($R)." WHERE ".(preg_match('~^[0-9]+$~',$_GET["value"])?"$s = $_GET[value] OR ":"")."$B LIKE ".q("$_GET[value]%")." ORDER BY 2 LIMIT $y");for($r=1;($I=$G->fetch_row())&&$r<$y;$r++)echo"<a href='".h(ME."edit=".urlencode($R)."&where".urlencode("[".bracket_escape(idf_unescape($s))."]")."=".urlencode($I[0]))."'>".h($I[1])."</a><br>\n";if($I)echo"...\n";}exit;}else{page_header(lang(64),"",false);if(adminer()->homepage()){echo"<form action='' method='post'>\n","<p>".lang(106).": <input type='search' name='query' value='".h($_POST["query"])."'> <input type='submit' value='".lang(42)."'>\n";if($_POST["query"]!="")search_tables();echo"<div class='scrollable'>\n","<table class='nowrap checkable odds'>\n",script("mixin(qsl('table'), {onclick: tableClick, ondblclick: partialArg(tableClick, true)});"),'<thead><tr class="wrap">','<td><input id="check-all" type="checkbox" class="jsonly">'.script("qs('#check-all').onclick = partial(formCheck, /^tables\[/);",""),'<th>'.lang(107),'<td>'.lang(108),"</thead>\n";foreach(table_status()as$R=>$I){$B=adminer()->tableName($I);if($B!=""){echo'<tr><td>'.checkbox("tables[]",$R,in_array($R,(array)$_POST["tables"],true)),"<th><a href='".h(ME).'select='.urlencode($R)."'>$B</a>";$X=format_number($I["Rows"]);echo"<td align='right'><a href='".h(ME."edit=").urlencode($R)."'>".($I["Engine"]=="InnoDB"&&$X?"~ $X":$X)."</a>";}}echo"</table>\n","</div>\n","</form>\n",script("tableCheck();");}}page_footer();