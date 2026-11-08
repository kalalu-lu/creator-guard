from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# 说明
# 1. 规则层只负责“快速兜底”和“预览快筛”，不追求 100% 准确。
# 2. 真正判断由本地大模型完成；规则层用于模型不可用、超时、或模型明显漏判时。
# 3. 所有规则都宁可不判，避免把普通批评误伤成恶意。
# ---------------------------------------------------------------------------

DM_ACTION = {
    "illegal": "涉嫌违法行为，建议截图留存",
    "malicious": "恶意私信，建议拉黑",
    "collab": "寻求合作，请尽快处理",
    "suggestion": "有效建议",
    "spam": "广告/引流，建议忽略",
    "normal": "普通私信",
}

DM_CATEGORIES = ("illegal", "malicious", "collab", "suggestion", "spam", "normal")
COMMENT_CATEGORIES = ("suggestion", "praise", "question", "negative", "malicious", "spam", "off_topic", "neutral")
STANCES = ("感动共鸣", "支持喜欢", "实用建议", "质疑反对", "愤怒攻击", "玩梗无关", "询问", "其他")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _hit(text: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


# 明确违法/高风险：暴力威胁、开盒、敲诈、诈骗、色情交易、赌博毒品等。
ILLEGAL_PATTERNS = (
    r"(杀|砍|弄死|打死|捅死)(你|他|她|全家)",
    r"让你(好看|消失|后悔)",
    r"上门(找你|弄你|砍你)",
    r"开盒|人肉(搜索|你)?|查出你(家|地址|单位)|曝光你(的)?(身份证|住址|电话|家人)",
    r"知道(你|你家).{0,8}(地址|住址|单位|学校|孩子)",
    r"敲诈|勒索|保护费|不给钱.{0,8}(曝光|举报|毁掉)",
    r"(不然|否则).{0,12}(曝光|发网上|毁掉|弄你)",
    r"(先|给我).{0,6}转.{0,10}(保证金|解冻|验证|手续费|诚意金)",
    r"(先|给我)转(账|钱).{0,12}(保证金|解冻|验证|手续费)",
    r"刷单|跑分|洗钱|博彩|赌博|网赌|毒品|冰毒|大麻",
    r"裸聊|约炮|包养|一夜情|性服务|上门服务",
    r"卖(你)?(身份证|银行卡|手机号|个人信息)|查(你)?(身份证|户籍|开房记录)",
    r"(验证码|银行卡号|身份证号).{0,10}(发我|给我|告诉我)",
)

# 辱骂、诅咒、羞辱、骚扰。普通差评/批评不放在这里。
MALICIOUS_PATTERNS = (
    r"傻逼|煞笔|沙比|傻B|脑残|弱智|智障|贱人|婊子|狗东西|废物|垃圾东西",
    r"去死|死全家|全家死|你怎么不去死|早点死",
    r"滚(吧|开|蛋)|闭嘴|丑八怪|肥猪|坦克",
    r"nmsl|cnm|tmd|操你|草泥马|日你|你妈(死|了|的)",
    r"(威胁|恐吓|骚扰)你|弄死你|找人(收拾|打)你",
    r"(天天|一直|反复)(骂|骚扰|私信)你",
)

COLLAB_PATTERNS = (
    r"商务合作|合作邀约|品牌合作|商业合作|广告合作",
    r"商务|报价|媒介|pr|PR|公关|品牌方|甲方",
    r"推广|探店|寄样|带货|坑位费|佣金|合作费用|投放",
    r"(我们|我)这边.{0,12}(合作|推广|报价|预算)",
    r"(有|接).{0,6}(合作|商单|广告)",
)

SPAM_PATTERNS = (
    r"加(我)?微信|加V|加v|vx|VX|私聊|私我",
    r"点击(链接|主页)|复制.{0,6}(链接|口令)|淘口令",
    r"兼职|日赚|月入|躺赚|返利|优惠券|内部价|刷单",
    r"互粉|互赞|互关|引流|涨粉|买粉",
    r"(免费|低价).{0,6}(领|送|课程|资料)",
)

SUGGESTION_MARKERS = (
    r"建议|希望|可以|能不能|能否|改进|调整|试试|下次|如果|不如|加点|减少",
    r"节奏|字幕|画质|选题|剪辑|封面|标题|转场|配乐|bgm|BGM|光线|收音|文案|开头|结尾",
)

# 评论里的“有效建议”比私信更严格：必须有建议意图，或明显可执行的动作。
# 否则“画质很好”“节奏不错”会被误判成建议。
COMMENT_SUGGESTION_INTENT = (
    r"建议|希望|可以|能不能|能否|改进|调整|试试|下次|如果|不如|最好|应该|需要",
    r"加点|减少|去掉|换成|改成|剪短|拉长|调亮|调暗|加字幕|配字幕|换个|多一点|少一点",
)

COMMENT_SUGGESTION_ACTION = (
    r"太.{0,4}(长|慢|快|吵|暗|糊|乱|拖)",
    r"(开头|结尾|前.{0,3}秒|中间).{0,8}(长|慢|拖|乱|赶)",
    r"(剪|调|换|加|去|删|改).{0,8}(一点|一下|点|掉|成|为)",
    r"(字幕|画质|收音|光线|节奏|配乐|bgm|BGM|封面|标题).{0,8}(不够|不好|不行|太差|有点|需要|应该|可以)",
)

PRAISE_PATTERNS = (
    r"好看|喜欢|感动|支持|太美|绝了|真棒|很棒|爱了|哭了|泪目|治愈|温柔|谢谢|学到",
    r"有被|戳中|共鸣|鸡皮疙瘩|起鸡皮疙瘩|封神|神作",
)

NEGATIVE_PATTERNS = (
    r"难看|不好看|无聊|尴尬|失望|拉胯|不行|一般|退步|没意思|浪费时间|看不下去",
    r"太差|很差|避雷|翻车|尬住|什么玩意|恶心|想吐|反胃",
    r"不喜欢|不支持|不推荐|不感兴趣|无感|不怎么样",
)

QUESTION_PATTERNS = (
    r"[?？]",
    r"请问|怎么|为什么|哪里|能不能|可以吗|求(问|教|链接)|什么(歌|软件|滤镜|相机)",
)

PLAYFUL_PATTERNS = (r"哈哈|笑死|梗|乐死|绷不住|离谱|抽象",)

TOPIC_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("剪辑节奏", (r"节奏|剪辑|转场|卡点|时长|拖沓|太慢|太快",)),
    ("选题内容", (r"选题|内容|题材|故事|剧情|脚本|方向",)),
    ("画质拍摄", (r"画质|清晰|拍摄|镜头|光线|打光|构图|收音|麦克风",)),
    ("表达文案", (r"文案|表达|口播|语速|声音|普通话|字幕|错别字",)),
    ("音乐音效", (r"音乐|配乐|bgm|BGM|音效|声音太大|声音太小",)),
    ("封面标题", (r"封面|标题|缩略图|点击率",)),
    ("互动运营", (r"更新|频率|直播|抽奖|互动|评论区",)),
)


def _dm_result(
    category: str,
    *,
    confidence: float,
    reason: str,
    evidence: list[str] | None = None,
    source: str = "rules",
) -> dict[str, Any]:
    severity = {"illegal": 3, "malicious": 2, "collab": 1, "spam": 1, "suggestion": 0, "normal": 0}[category]
    return {
        "category": category,
        "severity": severity,
        "confidence": round(confidence, 3),
        "reason": reason,
        "action": DM_ACTION[category],
        "hide_preview": category in {"illegal", "malicious"},
        "evidence": evidence or [],
        "source": source,
    }


def rule_dm(text: str) -> dict[str, Any]:
    text = normalize(text)
    if not text:
        return _dm_result("normal", confidence=0.3, reason="空文本")

    illegal = _hit(text, ILLEGAL_PATTERNS)
    malicious = _hit(text, MALICIOUS_PATTERNS)
    collab = _hit(text, COLLAB_PATTERNS)
    spam = _hit(text, SPAM_PATTERNS)
    suggestion_marker = _hit(text, SUGGESTION_MARKERS)

    if illegal:
        return _dm_result(
            "illegal",
            confidence=0.86,
            reason=f"命中高风险词：{illegal}",
            evidence=[illegal],
        )
    if malicious:
        return _dm_result(
            "malicious",
            confidence=0.8,
            reason=f"命中辱骂/威胁词：{malicious}",
            evidence=[malicious],
        )
    if collab:
        return _dm_result(
            "collab",
            confidence=0.76,
            reason=f"命中合作意向词：{collab}",
            evidence=[collab],
        )
    if spam:
        return _dm_result(
            "spam",
            confidence=0.7,
            reason=f"命中广告/引流词：{spam}",
            evidence=[spam],
        )
    if suggestion_marker and len(text) >= 12:
        return _dm_result(
            "suggestion",
            confidence=0.58,
            reason=f"出现建议表达：{suggestion_marker}",
            evidence=[suggestion_marker],
        )
    return _dm_result("normal", confidence=0.45, reason="未命中风险或合作规则")


def rule_preview(text: str) -> dict[str, Any]:
    result = rule_dm(text)
    return {
        "category": result["category"],
        "severity": result["severity"],
        "confidence": result["confidence"],
        "reason": result["reason"],
        "action": result["action"],
        "hide_preview": result["hide_preview"],
        "label": result["action"],
        "source": "rules-preview",
    }


def _topic(text: str) -> str:
    for label, patterns in TOPIC_RULES:
        if any(re.search(p, text, re.IGNORECASE) for p in patterns):
            return label
    return "其他"


def _comment_result(
    category: str,
    stance: str,
    *,
    confidence: float,
    reason: str,
    suggestion: str = "",
    topic: str = "其他",
    source: str = "rules",
) -> dict[str, Any]:
    return {
        "category": category,
        "stance": stance if stance in STANCES else "其他",
        "topic": topic,
        "is_actionable_suggestion": bool(suggestion),
        "suggestion": suggestion,
        "confidence": round(confidence, 3),
        "reason": reason,
        "source": source,
    }


def _clean_suggestion(text: str) -> str:
    text = normalize(text)
    text = re.sub(r"^(建议|希望|可以|能不能|能否|不如|最好)\s*", "", text)
    return text[:160]


def rule_comment(text: str) -> dict[str, Any]:
    text = normalize(text)
    if not text:
        return _comment_result("off_topic", "其他", confidence=0.2, reason="空文本")

    malicious = _hit(text, MALICIOUS_PATTERNS)
    spam = _hit(text, SPAM_PATTERNS)
    suggestion_intent = _hit(text, COMMENT_SUGGESTION_INTENT)
    suggestion_action = _hit(text, COMMENT_SUGGESTION_ACTION)
    praise = _hit(text, PRAISE_PATTERNS)
    negative = _hit(text, NEGATIVE_PATTERNS)
    question = _hit(text, QUESTION_PATTERNS)
    playful = _hit(text, PLAYFUL_PATTERNS)

    if malicious:
        return _comment_result(
            "malicious",
            "愤怒攻击",
            confidence=0.82,
            reason=f"命中辱骂/威胁词：{malicious}",
        )
    if spam:
        return _comment_result(
            "spam",
            "玩梗无关",
            confidence=0.7,
            reason=f"命中广告/引流词：{spam}",
        )

    # “可以告诉我 BGM 吗”是提问；“能不能加字幕”是建议。
    # 不要用单独的“长/短/多/少”做判断，否则“为什么这么长”会被误判。
    change_verb = bool(
        re.search(
            r"加点|减少|去掉|换成|改成|剪短|拉长|调亮|调暗|加字幕|配字幕|多拍|少拍|放大|缩小|提高|降低"
            r"|加大|调大|调小|变小|变快|变慢|提前|延后"
            r"|加.{0,4}(字幕|音乐|镜头|片段|特效|字)|减.{0,4}(时长|镜头)"
            r"|换.{0,4}(封面|音乐|BGM|bgm|开头|结尾)|调.{0,4}(色|亮|暗|音量|速度)"
            r"|剪.{0,4}(短|掉|一下)|删.{0,4}(掉|除|一下)",
            text,
        )
    )
    strong_intent = bool(re.search(r"建议|希望|改进|调整|试试|下次|加点|减少|去掉|换成|改成|剪短|拉长|调亮|调暗|加字幕", text))
    explicit_suggestion = bool(suggestion_intent) and (change_verb or strong_intent)
    if explicit_suggestion and len(text) >= 8:
        return _comment_result(
            "suggestion",
            "实用建议",
            confidence=0.66,
            reason=f"出现明确建议表达：{suggestion_intent}",
            suggestion=_clean_suggestion(text),
            topic=_topic(text),
        )
    if negative:
        return _comment_result("negative", "质疑反对", confidence=0.65, reason=f"出现负向评价：{negative}")
    if question and not change_verb:
        return _comment_result("question", "询问", confidence=0.6, reason="出现提问表达")
    if suggestion_action and len(text) >= 10:
        return _comment_result(
            "suggestion",
            "实用建议",
            confidence=0.58,
            reason=f"出现可执行动作：{suggestion_action}",
            suggestion=_clean_suggestion(text),
            topic=_topic(text),
        )
    if question:
        return _comment_result("question", "询问", confidence=0.55, reason="出现提问表达")
    if praise:
        stance = "感动共鸣" if re.search(r"感动|哭|泪|共鸣|戳中|治愈", text) else "支持喜欢"
        return _comment_result("praise", stance, confidence=0.65, reason=f"出现正向评价：{praise}")
    if playful:
        return _comment_result("neutral", "玩梗无关", confidence=0.5, reason="出现玩梗/调侃表达")
    if len(text) < 4:
        return _comment_result("off_topic", "其他", confidence=0.4, reason="文本过短")
    return _comment_result("neutral", "其他", confidence=0.4, reason="未命中明确类别")
